import pandas as pd
from sqlalchemy import text, create_engine

# 1. Provide your MySQL database credentials
db_user = "root"
db_password = "datamig123"
db_host = "127.0.0.1" # Usually localhost or 127.0.0.1
db_port = "3306"
db_name = "datamig_db"
connection_url = f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
engine = create_engine(connection_url)

try:
    # 2. Grab your existing data from Brands
    with engine.connect() as conn:
        df = pd.read_sql(text("SELECT * FROM Brands;"), conn)
        
    # 3. Create your new table from that dataframe!
    # df.to_sql("TestsPython", con=engine, if_exists="replace", index=False)
    # print("Table 'TestsPython' successfully created!")
    
    # 4. NOW you can query your brand new table to test it
    with engine.connect() as conn:
        new_df = pd.read_sql(text("SELECT * FROM TestsPython;"), conn)
        
    print("\n--- Query Results for TestsPython ---")
    print(new_df.to_markdown())
    print("-------------------------------------\n")
except Exception as e:
    print(f"Error: {e}")

# df.to_sql("TestsPython", con=engine, if_exists="replace", index=False)
print(new_df.shape)