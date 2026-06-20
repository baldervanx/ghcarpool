import '@tanstack/react-table';

declare module '@tanstack/react-table' {
    interface ColumnMeta<TData, TValue> {
        isSticky?: boolean;
        width?: string;
    }
}
