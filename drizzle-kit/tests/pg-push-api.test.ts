import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { index, integer, pgSequence, pgTable } from 'drizzle-orm/pg-core';
import { pushSchema } from 'src/api';
import { expect, test } from 'vitest';

test('pushSchema leaves an index alone whose only difference is INCLUDE columns', async () => {
	const client = new PGlite();
	await client.exec(`
		CREATE TABLE "t" ("a" integer NOT NULL, "b" integer NOT NULL);
		CREATE INDEX "t_a_covering_idx" ON "t" ("a") INCLUDE ("b");
	`);
	const t = pgTable('t', { a: integer('a').notNull(), b: integer('b').notNull() }, (table) => [
		index('t_a_covering_idx').on(table.a),
	]);

	const { statementsToExecute } = await pushSchema({ t }, drizzle(client) as any);

	expect(statementsToExecute).toStrictEqual([]);
});

test('pushSchema keeps a declared sequence that a table outside the tables filter owns', async () => {
	const client = new PGlite();
	await client.exec(`
		CREATE TABLE "ledger" ("id" integer PRIMARY KEY);
		CREATE SEQUENCE "ledger_numbers" OWNED BY "ledger"."id";
	`);
	const ledgerNumbers = pgSequence('ledger_numbers');

	const { statementsToExecute } = await pushSchema({ ledgerNumbers }, drizzle(client) as any, undefined, [
		'!ledger',
	]);

	expect(statementsToExecute.filter((it) => /\bSEQUENCE\b/.test(it))).toStrictEqual([]);
});
