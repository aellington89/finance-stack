CREATE TABLE "import_log" (
	"import_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_log_import_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_type" text NOT NULL,
	"file_name" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"status" text NOT NULL,
	"error_text" text,
	"row_count" integer,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_log_status_check" CHECK (status = ANY (ARRAY['imported'::text, 'failed'::text])),
	CONSTRAINT "import_log_error_text_check" CHECK ((status = 'failed') = (error_text IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_import_log_sha256_imported" ON "import_log" USING btree ("sha256" bpchar_ops) WHERE status = 'imported';--> statement-breakpoint
CREATE INDEX "idx_import_log_sha256" ON "import_log" USING btree ("sha256" bpchar_ops);--> statement-breakpoint
CREATE INDEX "idx_import_log_imported_at" ON "import_log" USING btree ("imported_at" timestamptz_ops);