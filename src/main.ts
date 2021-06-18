import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as AWS from 'aws-sdk'
import * as fs from 'fs'
import {promisify} from 'util'
import simpleGit, {Response} from 'simple-git'

const readFilePromise = promisify(fs.readFile)
const awsS3Client = new AWS.S3()
const git = simpleGit()

async function zipSourceCode(
  removeGitDir: boolean,
  quiet: boolean
): Promise<number> {
  if (removeGitDir) {
    core.info('Removing .git folder')
    await exec.exec('rm -rf .git')
  }

  let zipCommandOpts = '-r'
  if (quiet) {
    zipCommandOpts = '-rqq'
  }
  return exec.exec(`zip ${zipCommandOpts} src.zip ./`)
}

async function unzipSourceCode(
  treeHash: string,
  quiet: boolean
): Promise<number> {
  let unzipCommandOpts = ''
  if (quiet) {
    unzipCommandOpts = '-qq'
  }
  return exec.exec(`unzip ${unzipCommandOpts} ${treeHash}.zip`)
}

function getGitTreeHash(): Response<string> {
  return git.revparse('HEAD:')
}

async function isObjectPresent(bucket: string, hash: string): Promise<boolean> {
  const key = `${hash}.zip`

  core.info(`Checking if ${key} is present in ${bucket}`)

  try {
    const res = await awsS3Client
      .headObject({
        Bucket: bucket,
        Key: key
      })
      .promise()

    core.info(`headObject response: ${res}`)
    return true
  } catch (err) {
    core.info(`${key} is not present in ${bucket}`)
    return false
  }
}

async function putObjectToS3(
  bucket: string,
  treehash: string
): Promise<AWS.S3.ManagedUpload.SendData> {
  core.info('Uploading file to S3')
  const fileContent = await readFilePromise('src.zip')

  return awsS3Client
    .upload({
      Bucket: bucket,
      Key: `${treehash}.zip`,
      Body: fileContent
    })
    .promise()
}

async function cacheRepo(
  s3Bucket: string,
  removeGitDir: boolean,
  quiet: boolean
): Promise<void> {
  core.info(`Caching repo in S3: ${s3Bucket}`)

  const treeHash = await getGitTreeHash()

  core.setOutput('treeHash', treeHash)

  const objectPresent = await isObjectPresent(s3Bucket, treeHash)

  if (objectPresent) {
    core.info(`Repo with tree hash: ${treeHash} has been already cached in S3`)
    return
  }

  await zipSourceCode(removeGitDir, quiet)
  await putObjectToS3(s3Bucket, treeHash)
}

async function fetchRepo(s3Bucket: string, quiet: boolean): Promise<void> {
  const treeHash = core.getInput('treeHash', {required: true})
  core.info(
    `Restoring Git repo cache with tree hash: ${treeHash} from S3 bucket: ${s3Bucket}`
  )

  const fileName = `${treeHash}.zip`

  const readStream = awsS3Client
    .getObject({
      Bucket: s3Bucket,
      Key: fileName
    })
    .createReadStream()

  readStream.on('error', async e => Promise.reject(e))
  const writeStream = fs.createWriteStream(fileName)
  writeStream.once('finish', async () => {
    await unzipSourceCode(treeHash, quiet)
    await exec.exec(`rm ${treeHash}.zip`)
  })
  readStream.pipe(writeStream)
}

async function run(): Promise<void> {
  try {
    const s3Bucket = core.getInput('s3Bucket', {required: true})
    const operation = core.getInput('operation', {required: true})
    const removeGitDir = core.getInput('removeGitDir') === 'true'
    const quiet = core.getInput('quiet') === 'true'

    switch (operation) {
      case 'cache':
        await cacheRepo(s3Bucket, removeGitDir, quiet)
        break
      case 'fetch':
        await fetchRepo(s3Bucket, quiet)
        break
      default:
        throw new Error(
          `Operation: ${operation} is invalid. Should be either cache or fetch`
        )
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
