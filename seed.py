import sys
from sqlalchemy import create_engine, text

db_user = "root"
db_password = "datamig123"
db_host = "127.0.0.1"
db_port = "3306"
db_name = "datamig_db"

connection_url = f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
engine = create_engine(connection_url)

try:
    with open('setup-db.sql', 'r') as file:
        sql_script = file.read()
        
    with engine.connect() as conn:
        for statement in sql_script.split(';'):
            if statement.strip():
                conn.execute(text(statement))
        conn.commit()
    print("Successfully seeded the database!")
except Exception as e:
    print(f"Error seeding database: {e}")
