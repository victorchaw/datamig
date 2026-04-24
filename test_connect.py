from sqlalchemy import create_engine, text
db_url = "mysql+pymysql://root:datamig123@127.0.0.1:3306/datamig_db"
print("Attempting to connect...")
try:
    new_engine = create_engine(db_url, pool_pre_ping=True)
    with new_engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("Success")
except Exception as e:
    print("Exception caught inside try-except:")
    print(e)
