import { preparePgPush } from 'src/cli/commands/migrate';
import { expect, test } from 'vitest';

type Idx = { name: string; columns: string[]; method: string; isUnique?: boolean; opclass?: string };

const index = ({ name, columns, method, isUnique = false, opclass }: Idx) => ({
	name,
	columns: columns.map((expression) => ({
		expression,
		isExpression: false,
		asc: true,
		nulls: 'last',
		...(opclass ? { opclass } : {}),
	})),
	isUnique,
	concurrently: false,
	method,
	with: {},
});

const text = (name: string) => ({ name, type: 'text', primaryKey: false, notNull: true });

const snapshot = (parentIndexes: Idx[], childIndexes: Idx[]) =>
	({
		version: '7',
		dialect: 'postgresql',
		id: '0',
		prevId: '0',
		tables: {
			'public.parent': {
				name: 'parent',
				schema: '',
				columns: { id: { ...text('id'), primaryKey: true }, scope_id: text('scope_id') },
				indexes: Object.fromEntries(parentIndexes.map((it) => [it.name, index(it)])),
				foreignKeys: {},
				compositePrimaryKeys: {},
				uniqueConstraints: {},
				policies: {},
				checkConstraints: {},
				isRLSEnabled: false,
			},
			'public.child': {
				name: 'child',
				schema: '',
				columns: { id: { ...text('id'), primaryKey: true }, parent_id: text('parent_id'), scope_id: text('scope_id') },
				indexes: Object.fromEntries(childIndexes.map((it) => [it.name, index(it)])),
				foreignKeys: {
					child_parent_scope_fk: {
						name: 'child_parent_scope_fk',
						tableFrom: 'child',
						tableTo: 'parent',
						schemaTo: 'public',
						columnsFrom: ['scope_id', 'parent_id'],
						columnsTo: ['scope_id', 'id'],
						onDelete: 'cascade',
						onUpdate: 'no action',
					},
				},
				compositePrimaryKeys: {},
				uniqueConstraints: {},
				policies: {},
				checkConstraints: {},
				isRLSEnabled: false,
			},
		},
		enums: {},
		schemas: {},
		sequences: {},
		roles: {},
		policies: {},
		views: {},
		_meta: { schemas: {}, tables: {}, columns: {} },
	}) as any;

const scopeUnique = (method: string, columns = ['scope_id', 'id']) => ({
	name: 'parent_scope_id_unique',
	columns,
	method,
	isUnique: true,
});
const trigram = (method: string) => ({
	name: 'child_scope_trgm_idx',
	columns: ['scope_id'],
	method,
	opclass: 'gin_trgm_ops',
});

test('push matches YugabyteDB lsm and ybgin indexes to btree and gin and leaves the foreign key alone', async () => {
	const schema = snapshot([scopeUnique('btree')], [trigram('gin')]);
	const database = snapshot([scopeUnique('lsm')], [trigram('ybgin')]);

	const { sqlStatements } = await preparePgPush(schema, database);

	expect(sqlStatements).toStrictEqual([]);
});

test('push still re-creates a YugabyteDB lsm index whose columns changed', async () => {
	const schema = snapshot([scopeUnique('btree', ['id', 'scope_id'])], []);
	const database = snapshot([scopeUnique('lsm')], []);

	const { sqlStatements } = await preparePgPush(schema, database);

	expect(sqlStatements).toContain('DROP INDEX "parent_scope_id_unique";');
	expect(sqlStatements).toContain(
		'CREATE UNIQUE INDEX "parent_scope_id_unique" ON "parent" USING btree ("id","scope_id");',
	);
});

test('push still re-creates an index whose access method really changed', async () => {
	const schema = snapshot([], [trigram('btree')]);
	const database = snapshot([], [trigram('ybgin')]);

	const { sqlStatements } = await preparePgPush(schema, database);

	expect(sqlStatements).toContain('DROP INDEX "child_scope_trgm_idx";');
	expect(sqlStatements.some((it) => it.startsWith('CREATE INDEX "child_scope_trgm_idx"') && it.includes('USING btree')))
		.toBe(
			true,
		);
});

const sequenced = (cache: string) =>
	({
		...snapshot([], []),
		tables: {
			'public.decisions': {
				name: 'decisions',
				schema: '',
				columns: {
					sequence: {
						name: 'sequence',
						type: 'bigint',
						primaryKey: false,
						notNull: true,
						identity: {
							name: 'decisions_sequence_seq',
							schema: 'public',
							type: 'always',
							increment: '1',
							minValue: '1',
							maxValue: '9223372036854775807',
							startWith: '1',
							cache,
							cycle: false,
						},
					},
				},
				indexes: {},
				foreignKeys: {},
				compositePrimaryKeys: {},
				uniqueConstraints: {},
				policies: {},
				checkConstraints: {},
				isRLSEnabled: false,
			},
		},
		sequences: {
			'public.counter': {
				name: 'counter',
				schema: 'public',
				increment: '1',
				minValue: '1',
				maxValue: '9223372036854775807',
				startWith: '1',
				cache,
				cycle: false,
			},
		},
	}) as any;

test('push accepts the cache YugabyteDB raised to its minimum for identities and sequences', async () => {
	const { sqlStatements } = await preparePgPush(sequenced('1'), sequenced('100'), { sequenceCacheMinimum: 100 });

	expect(sqlStatements).toStrictEqual([]);
});

test('push still changes a cache that differs on PostgreSQL', async () => {
	const { sqlStatements } = await preparePgPush(sequenced('1'), sequenced('100'));

	expect(sqlStatements.some((it) => it.includes('"decisions"') && it.includes('SET CACHE 1'))).toBe(true);
	expect(sqlStatements.some((it) => it.includes('"public"."counter"') && it.includes('CACHE 1'))).toBe(true);
});

test('push still changes a cache above the YugabyteDB minimum', async () => {
	const { sqlStatements } = await preparePgPush(sequenced('500'), sequenced('100'), { sequenceCacheMinimum: 100 });

	expect(sqlStatements.some((it) => it.includes('"decisions"') && it.includes('SET CACHE 500'))).toBe(true);
	expect(sqlStatements.some((it) => it.includes('"public"."counter"') && it.includes('CACHE 500'))).toBe(true);
});

test('push changes a cache below the YugabyteDB minimum that differs from the database', async () => {
	const { sqlStatements } = await preparePgPush(sequenced('1'), sequenced('50'), { sequenceCacheMinimum: 100 });

	expect(sqlStatements.some((it) => it.includes('"decisions"') && it.includes('SET CACHE 1'))).toBe(true);
	expect(sqlStatements.some((it) => it.includes('"public"."counter"') && it.includes('CACHE 1'))).toBe(true);
});

test('push compares caches exactly with a YugabyteDB minimum of 0', async () => {
	const { sqlStatements } = await preparePgPush(sequenced('1'), sequenced('100'), { sequenceCacheMinimum: 0 });

	expect(sqlStatements.some((it) => it.includes('"decisions"') && it.includes('SET CACHE 1'))).toBe(true);
});
