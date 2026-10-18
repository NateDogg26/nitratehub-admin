PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS apps(id TEXT PRIMARY KEY,name TEXT NOT NULL,bundle_id TEXT NOT NULL,platform TEXT NOT NULL,color TEXT NOT NULL,connected INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,username TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,app_id TEXT NOT NULL REFERENCES apps(id),token TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('development','production')),model TEXT NOT NULL DEFAULT '',label TEXT NOT NULL DEFAULT '',mine INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1,last_seen TEXT NOT NULL,source_identifier TEXT NOT NULL DEFAULT '',identifier_kind TEXT NOT NULL DEFAULT 'app_id',hardware_udid TEXT NOT NULL DEFAULT '',device_name TEXT NOT NULL DEFAULT '',notification_status TEXT NOT NULL DEFAULT 'registered',app_version TEXT NOT NULL DEFAULT '',UNIQUE(app_id,token,environment));
CREATE INDEX IF NOT EXISTS devices_app ON devices(app_id,environment,enabled);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,app_id TEXT NOT NULL REFERENCES apps(id),installation_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_app_date ON events(app_id,created_at);
CREATE TABLE IF NOT EXISTS sends(id TEXT PRIMARY KEY,app_id TEXT NOT NULL REFERENCES apps(id),title TEXT NOT NULL,audience TEXT NOT NULL,total INTEGER NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,unknown INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'sending',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sends_date ON sends(created_at);
CREATE TABLE IF NOT EXISTS deliveries(send_id TEXT NOT NULL REFERENCES sends(id),device_id TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',PRIMARY KEY(send_id,device_id));
INSERT OR IGNORE INTO apps(id,name,bundle_id,platform,color) VALUES
('neighbourhood','Neighbourhood','com.nathanburgess.Neighbourhood','iOS / Android','#d3e6ae'),
('keyra','Keyra','xyz.nitratehub.keyra','iOS','#c4b5f4'),
('revyn','REVYN','com.nathanburgess.revyn','iOS','#b9cbed'),
('hondodvr','HondoDVR','com.nathanburgess.HondoDVR','iOS','#eeb98b'),
('keeper','Keeper','com.nathanburgess.Keeper','iOS','#a8cfbf'),
('detailflow','DetailFlow','com.nathanburgess.DetailFlow','iOS','#dab9d4'),
('suuboard','SuuBoard','xyz.nitratehub.SuuBoard','iOS','#e3d69c'),
('glasssnake','GlassSnake','com.nathanburgess.GlassSnake','iOS','#a6d8e1'),
('latency','Latency','com.hondo.Latency','iOS','#bdbecb'),
('ctos','ctOS','com.ctos.monitor','iOS','#b6c4d0'),
('the-vault','The Vault','','Web','#c8bd9d');

CREATE TABLE IF NOT EXISTS client_installations(app_id TEXT NOT NULL REFERENCES apps(id),installation_id TEXT NOT NULL,secret_hash TEXT NOT NULL,PRIMARY KEY(app_id,installation_id));
