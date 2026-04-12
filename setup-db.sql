-- ════════════════════════════════════════════════════════════
-- datamig — Database Setup Script
-- Creates the datamig_db database with Brands and Countries tables
-- ════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS datamig_db;
USE datamig_db;

-- ─── Countries Table ───
CREATE TABLE IF NOT EXISTS Countries (
    ct_ID         INT           NOT NULL AUTO_INCREMENT,
    ct_Name       VARCHAR(100)  NOT NULL,
    ct_Code       VARCHAR(5)    NULL,
    PRIMARY KEY (ct_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Brands Table ───
CREATE TABLE IF NOT EXISTS Brands (
    br_ID           INT           NOT NULL AUTO_INCREMENT,
    br_Name         VARCHAR(100)  NOT NULL,
    br_Description  VARCHAR(500)  NULL,
    br_Countries_ID INT           NULL,
    br_Website      VARCHAR(255)  NULL,
    br_ContactEmail VARCHAR(255)  NULL,
    PRIMARY KEY (br_ID),
    CONSTRAINT fk_brands_countries FOREIGN KEY (br_Countries_ID) REFERENCES Countries(ct_ID)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Seed Data: Countries ───
INSERT INTO Countries (ct_Name, ct_Code) VALUES
    ('Iraq',        'IQ'),
    ('Kurdistan',   'KRG'),
    ('Turkey',      'TR'),
    ('Iran',        'IR'),
    ('Syria',       'SY')
ON DUPLICATE KEY UPDATE ct_Name = VALUES(ct_Name);

-- Higher-range IDs used in testdata.csv
INSERT INTO Countries (ct_ID, ct_Name, ct_Code) VALUES
    (105, 'Kurdistan Region', 'KRG'),
    (106, 'Iraq',             'IQ'),
    (107, 'Kurdistan Region', 'KRG'),
    (108, 'Kurdistan Region', 'KRG')
ON DUPLICATE KEY UPDATE ct_Name = VALUES(ct_Name);

SELECT '✓ datamig_db setup complete' AS status;
SELECT CONCAT('  → Countries: ', COUNT(*), ' rows') AS info FROM Countries;
SELECT CONCAT('  → Brands:    ', COUNT(*), ' rows') AS info FROM Brands;
