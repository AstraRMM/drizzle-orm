import { truncatePgIdentifier, truncatePgSchemaIdentifiers } from 'src/serializer/pgSchema';
import { expect, test } from 'vitest';

test('truncatePgIdentifier keeps names up to 63 bytes', () => {
	expect(truncatePgIdentifier('posts_author_id_users_id_fk')).toBe('posts_author_id_users_id_fk');
	expect(truncatePgIdentifier('a'.repeat(63))).toBe('a'.repeat(63));
});

test('truncatePgIdentifier cuts longer names to 63 bytes like PostgreSQL', () => {
	expect(truncatePgIdentifier('a'.repeat(64))).toBe('a'.repeat(63));
	expect(
		truncatePgIdentifier('managed_compute_allocations_resource_id_managed_compute_resources_id_fk'),
	).toBe('managed_compute_allocations_resource_id_managed_compute_resourc');
});

test('truncatePgIdentifier never splits a multibyte character', () => {
	// 62 ASCII bytes + a 2-byte character would be 64 bytes: PostgreSQL drops the whole character.
	expect(truncatePgIdentifier(`${'a'.repeat(62)}é`)).toBe('a'.repeat(62));
	expect(truncatePgIdentifier(`${'a'.repeat(61)}é`)).toBe(`${'a'.repeat(61)}é`);
	expect(truncatePgIdentifier(`${'a'.repeat(61)}😀b`)).toBe('a'.repeat(61));
});

const tableWith = (foreignKeys: Record<string, { name: string }>) => ({
	version: '7',
	dialect: 'postgresql',
	id: '0',
	prevId: '0',
	tables: {
		'public.t': {
			name: 't',
			schema: '',
			columns: {},
			indexes: {},
			foreignKeys,
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

test('truncatePgSchemaIdentifiers renames keys and names to the stored form', () => {
	const long = `${'f'.repeat(70)}_fk`;
	const result = truncatePgSchemaIdentifiers(tableWith({ [long]: { name: long } }));
	expect(result.tables['public.t'].foreignKeys).toStrictEqual({ ['f'.repeat(63)]: { name: 'f'.repeat(63) } });
});

test('truncatePgSchemaIdentifiers rejects names that collide once truncated', () => {
	const a = `${'f'.repeat(63)}_one`;
	const b = `${'f'.repeat(63)}_two`;
	expect(() => truncatePgSchemaIdentifiers(tableWith({ [a]: { name: a }, [b]: { name: b } }))).toThrow(
		/same name/,
	);
});
