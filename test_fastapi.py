import traceback
from server import connect_db, DbCredentials
creds = DbCredentials(dialect="mysql+pymysql", host="127.0.0.1", port="3306", username="root", password="datamig123", dbname="datamig_db")
print("calling connect_db directly...")
try:
    res = connect_db(creds)
    print("Success directly", res)
except Exception as e:
    print("Direct call failed:")
    traceback.print_exc()

