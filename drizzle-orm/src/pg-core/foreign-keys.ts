import { entityKind } from '~/entity.ts';
import { TableName } from '~/table.utils.ts';
import type { AnyPgColumn, PgColumn } from './columns/index.ts';
import type { PgTable } from './table.ts';

export type UpdateDeleteAction = 'cascade' | 'restrict' | 'no action' | 'set null' | 'set default';

/**
 * `ON DELETE` actions. In addition to {@link UpdateDeleteAction}, PostgreSQL 15+ accepts a column list for
 * `SET NULL` and `SET DEFAULT`, so only those columns of a composite foreign key are changed:
 *
 * ```ts
 * foreignKey({ columns: [t.orgId, t.authorId], foreignColumns: [users.orgId, users.id] })
 * 	.onDelete('set null (author_id)')
 * ```
 *
 * The column list is passed to SQL as written, so use database column names (not TypeScript keys,
 * which matters with `casing`) and quote names that need it, as in SQL. drizzle-kit compares lists
 * after normalizing them, so `set null (author_id)` and `set null ("author_id")` are the same action.
 */
export type DeleteAction = UpdateDeleteAction | `set null (${string})` | `set default (${string})`;

export type Reference = () => {
	readonly name?: string;
	readonly columns: PgColumn[];
	readonly foreignTable: PgTable;
	readonly foreignColumns: PgColumn[];
};

export class ForeignKeyBuilder {
	static readonly [entityKind]: string = 'PgForeignKeyBuilder';

	/** @internal */
	reference: Reference;

	/** @internal */
	_onUpdate: UpdateDeleteAction | undefined = 'no action';

	/** @internal */
	_onDelete: DeleteAction | undefined = 'no action';

	constructor(
		config: () => {
			name?: string;
			columns: PgColumn[];
			foreignColumns: PgColumn[];
		},
		actions?: {
			onUpdate?: UpdateDeleteAction;
			onDelete?: DeleteAction;
		} | undefined,
	) {
		this.reference = () => {
			const { name, columns, foreignColumns } = config();
			return { name, columns, foreignTable: foreignColumns[0]!.table as PgTable, foreignColumns };
		};
		if (actions) {
			this._onUpdate = actions.onUpdate;
			this._onDelete = actions.onDelete;
		}
	}

	onUpdate(action: UpdateDeleteAction): this {
		this._onUpdate = action === undefined ? 'no action' : action;
		return this;
	}

	onDelete(action: DeleteAction): this {
		this._onDelete = action === undefined ? 'no action' : action;
		return this;
	}

	/** @internal */
	build(table: PgTable): ForeignKey {
		return new ForeignKey(table, this);
	}
}

export type AnyForeignKeyBuilder = ForeignKeyBuilder;

export class ForeignKey {
	static readonly [entityKind]: string = 'PgForeignKey';

	readonly reference: Reference;
	readonly onUpdate: UpdateDeleteAction | undefined;
	readonly onDelete: DeleteAction | undefined;

	constructor(readonly table: PgTable, builder: ForeignKeyBuilder) {
		this.reference = builder.reference;
		this.onUpdate = builder._onUpdate;
		this.onDelete = builder._onDelete;
	}

	getName(): string {
		const { name, columns, foreignColumns } = this.reference();
		const columnNames = columns.map((column) => column.name);
		const foreignColumnNames = foreignColumns.map((column) => column.name);
		const chunks = [
			this.table[TableName],
			...columnNames,
			foreignColumns[0]!.table[TableName],
			...foreignColumnNames,
		];
		return name ?? `${chunks.join('_')}_fk`;
	}
}

type ColumnsWithTable<
	TTableName extends string,
	TColumns extends PgColumn[],
> = { [Key in keyof TColumns]: AnyPgColumn<{ tableName: TTableName }> };

export function foreignKey<
	TTableName extends string,
	TForeignTableName extends string,
	TColumns extends [AnyPgColumn<{ tableName: TTableName }>, ...AnyPgColumn<{ tableName: TTableName }>[]],
>(
	config: {
		name?: string;
		columns: TColumns;
		foreignColumns: ColumnsWithTable<TForeignTableName, TColumns>;
	},
): ForeignKeyBuilder {
	function mappedConfig() {
		const { name, columns, foreignColumns } = config;
		return {
			name,
			columns,
			foreignColumns,
		};
	}

	return new ForeignKeyBuilder(mappedConfig);
}
