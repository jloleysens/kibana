# @kbn/sort-predicates

This package contains a flexible sorting function who supports the following types:

* string
* number
* version
* ip addresses (both IPv4 and IPv6) - handles `Others`/strings correcly in this case
* dates
* ranges open and closed (number type only for now)
* null and undefined (always sorted as last entries, no matter the direction)
* any multi-value version of the types above (version excluded)

The function is intended to use with objects and to simplify the usage with sorting by a specific column/field.
The functions has been extracted from Lens datatable where it was originally used.

### How to use it

Basic usage with an array of objects:

```js
import { getSortingCriteria } from '@kbn/sorting-predicates';

...
const predicate = getSortingCriteria( typeHint, columnId, formatterFn );

const orderedRows = [{a: 1, b: 2}, {a: 3, b: 4}]
    .sort( (rowA, rowB) => predicate(rowA, rowB, 'asc' /* or 'desc' */));
```

Basic usage with EUI DataGrid schemaDetector:

```tsx
const [data, setData] = useState(table);
const dataGridColumns: EuiDataGridColumn[] = data.columns.map( (column) => ({
    ...
    schema: getColumnType(column)
}));
const [sortingColumns, setSortingColumns] = useState([
  { id: 'custom', direction: 'asc' },
]);

const schemaDetectors = dataGridColumns.map((column) => {
    const sortingHint = getColumnType(column);
    const sortingCriteria = getSortingCriteria(
        sortingHint,
        column.id,
        (val: unknwon) => String(val)
    );
    return {
        sortTextAsc: 'asc'
        sortTextDesc: 'desc',
        icon: 'starFilled',
        type: sortingHint || '',
        detector: () => 1,
        // This is the actual logic that is used to sort the table
        comparator: (_a, _b, direction, { aIndex, bIndex }) =>
        sortingCriteria(data.rows[aIndex], data.rows[bIndex], direction) as 0 | 1 | -1
    };
});

return <EuiDataGrid
    ...
    inMemory={{ level: 'sorting' }}
    columns={dataGridColumns}
    schemaDetectors={schemaDetectors}
    sorting={{
        columns: sortingColumns,
        // this is called only for those columns not covered by the schema detector
        // and can use the sorting predica as well, manually applied to the data rows
        onSort: () => { ... }
    }}
/>;
```