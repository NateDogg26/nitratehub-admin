ALTER TABLE devices ADD COLUMN source_identifier TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN identifier_kind TEXT NOT NULL DEFAULT 'app_id';
ALTER TABLE devices ADD COLUMN hardware_udid TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN notification_status TEXT NOT NULL DEFAULT 'registered';
ALTER TABLE devices ADD COLUMN app_version TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS client_installations(app_id TEXT NOT NULL REFERENCES apps(id),installation_id TEXT NOT NULL,secret_hash TEXT NOT NULL,PRIMARY KEY(app_id,installation_id));
