class CreateTodos < ActiveRecord::Migration[7.2]
  def change
    create_table :todos do |t|
      t.integer :user_id
      t.integer :category_id
      t.string :title
      t.text :description
      t.datetime :deadline
      t.boolean :completed

      t.timestamps
    end
  end
end
