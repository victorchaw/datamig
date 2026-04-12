import requests
import json
import os

url = "http://localhost:3000/api/etl-upload"

# Create a test CSV
csv_content = """company_name,contact_email,contact_name,desc
ACME Corp,john@acme.com,John Doe,ACME Description
Tech Inc,jane@tech.com,Jane Smith,Tech Description"""
with open("test_relational.csv", "w") as f:
    f.write(csv_content)

# Test 1: Insert Parent (Countries/Companies), then Insert Child (Brands/Contacts) with Lookup
lookup_config = {
    "separator": ",",
    "hasHeader": True,
    "tables": {
        "Countries": {
            "operation": "insert",
            "matchKeys": [],
            "mappings": [
                {"csvColumn": "company_name", "dbColumn": "ct_Name"},
                {"csvColumn": "desc", "dbColumn": "ct_Continent"}
            ]
        },
        "Brands": {
            "operation": "insert",
            "matchKeys": [],
            "mappings": [
                {"csvColumn": "contact_name", "dbColumn": "br_Name"},
                {"csvColumn": "contact_email", "dbColumn": "br_Email"},
                {
                    "csvColumn": "company_name", 
                    "dbColumn": "br_Countries_ID", 
                    "isLookup": True,
                    "lookupTable": "Countries",
                    "lookupMatchColumn": "ct_Name"
                }
            ]
        }
    }
}

print("Testing Relational Lookup (Goal 2)...")
with open("test_relational.csv", "rb") as f:
    files = {"file": f}
    data = {"mapping_config": json.dumps(lookup_config)}
    r = requests.post(url, files=files, data=data)
    print(r.status_code, r.text)

# Test 2: Update Contact Description
upsert_csv_content = """company_name,contact_email,contact_name,desc
Tech Inc,jane@tech.com,Jane Smith,Tech Description UPDATED"""
with open("test_upsert.csv", "w") as f:
    f.write(upsert_csv_content)

update_config = {
    "separator": ",",
    "hasHeader": True,
    "tables": {
        "Brands": {
            "operation": "update",
            "matchKeys": ["br_Email"],
            "mappings": [
                {"csvColumn": "desc", "dbColumn": "br_Description"},
                {"csvColumn": "contact_email", "dbColumn": "br_Email"}
            ]
        }
    }
}

print("Testing Update (Goal 3)...")
with open("test_upsert.csv", "rb") as f:
    files = {"file": f}
    data = {"mapping_config": json.dumps(update_config)}
    r = requests.post(url, files=files, data=data)
    print(r.status_code, r.text)
