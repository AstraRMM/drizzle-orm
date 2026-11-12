import { normalizePgDeleteAction } from 'src/serializer/pgSerializer';
import { expect, test } from 'vitest';

test('normalizePgDeleteAction leaves plain actions alone', () => {
	expect(normalizePgDeleteAction(undefined)).toBe(undefined);
	for (const action of ['cascade', 'restrict', 'no action', 'set null', 'set default']) {
		expect(normalizePgDeleteAction(action)).toBe(action);
	}
});

test('normalizePgDeleteAction quotes every column and folds unquoted names', () => {
	expect(normalizePgDeleteAction('set null (author_id)')).toBe('set null ("author_id")');
	expect(normalizePgDeleteAction('set null ("author_id")')).toBe('set null ("author_id")');
	expect(normalizePgDeleteAction('SET NULL (Author_Id,"editorId")')).toBe('set null ("author_id", "editorId")');
	expect(normalizePgDeleteAction('set  default(  b ,  a )')).toBe('set default ("b", "a")');
	expect(normalizePgDeleteAction('set null ("we""ird, name", position)')).toBe('set null ("we""ird, name", "position")');
});

test('normalizePgDeleteAction returns lists it cannot parse unchanged', () => {
	for (const action of ['set null ()', 'set null ("open)', 'set null (a,)', 'set null (a b)', 'set null ("a" b)']) {
		expect(normalizePgDeleteAction(action)).toBe(action);
	}
});
