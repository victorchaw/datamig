# How to Test SQL Queries on Mac

Since you don't have a database workbench installed, you can easily test your SQL queries and interact with your databases directly from your terminal or using Python.

## 1. Using Python & Pandas (Recommended)

Since this project's environment already includes `SQLAlchemy`, `PyMySQL`, and `Pandas` (as confirmed in `requirements.txt`), using Python is one of the easiest ways to execute and visualize SQL data. Pandas will output your query results in a clean, tabular format right in your terminal.

Create a new file called `test_query.py` in your workspace and use the following template:

```python
import pandas as pd
from sqlalchemy import text, create_engine

# 1. Provide your MySQL database credentials
db_user = "your_username"
db_password = "your_password"
db_host = "localhost" # Usually localhost or 127.0.0.1
db_port = "3306"
db_name = "your_database"

# 2. Create the Database engine
connection_url = f"mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
engine = create_engine(connection_url)

# 3. Write your SQL query here
sql_query = """
SELECT *
FROM information_schema.tables 
LIMIT 5;
"""

try:
    # 4. Execute the query and load results into a Pandas DataFrame
    with engine.connect() as conn:
        df = pd.read_sql(text(sql_query), conn)

    # 5. Print the results (to_markdown looks great in the terminal)
    print("\n--- Query Results ---")
    print(df.to_markdown())
    print("---------------------\n")
except Exception as e:
    print(f"Error executing query: {e}")
```

**To run it**:
```bash
# Ensure your virtual environment is active, then run:
python test_query.py
```

---

## 2. Using the Terminal (Command Line)

If you have MySQL installed on your Mac, you can connect directly using the MySQL CLI tool.

Open your terminal and run:
```bash
mysql -u your_username -p -h localhost
```
- You will be prompted to enter your password.
- If you want to connect to a specific database right away, append the database name to the end: `mysql -u your_username -p -h localhost your_database`

Once connected, your prompt will change to `mysql> `. You can type your SQL queries directly:
```sql
mysql> USE your_database;
mysql> SHOW TABLES;
mysql> SELECT * FROM your_table LIMIT 5;
```

**Tip**: Always end your SQL commands in the terminal with a semicolon (`;`). Type `exit;` to leave.

*Note: If the `mysql` command is not found, you can install the MySQL client via Homebrew: `brew install mysql-client`*

---

## 3. Running SQL from a File via Terminal

If you have a large query or you are testing a lot of SQL files, you can save your queries in an SQL file, such as `query.sql`, and execute it directly from the terminal.

```bash
mysql -u your_username -p your_database < query.sql
```
This is handy when you want to run `setup-db.sql` or scripts like it.

---

## Need a Lightweight Desktop App Later?
If you later decide you want a graphical interface without paying, here are great options for Mac:
- **Sequel Ace**: (Recommended for MySQL/MariaDB) Free, open-source native Mac app. Very lightweight and performant. You can install it from the Mac App Store.
- **TablePlus**: Great native Mac app (has a free tier that is plenty for standard testing).
- **DBeaver**: Free and supports almost every database engine, but slightly heavier.
