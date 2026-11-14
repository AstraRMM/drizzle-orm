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
