ALTER TABLE "subscriptions" ADD COLUMN "license_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_license_id_idx" ON "subscriptions" USING btree ("license_id");--> statement-breakpoint
-- Existing rows: each license is linked to the subscription that paid for it.
UPDATE "subscriptions" SET "license_id" = "licenses"."id" FROM "licenses" WHERE "licenses"."subscription_id" = "subscriptions"."id";
