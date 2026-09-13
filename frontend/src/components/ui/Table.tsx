import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * Table primitives at a fixed 32px row height. Header cells are mono label-caps;
 * numeric cells opt in with `numeric` so figures align on the decimal.
 */

export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
	return (
		<div className="w-full overflow-x-auto">
			<table className={cn('w-full border-collapse text-left', className)} {...rest}>
				{children}
			</table>
		</div>
	)
}

export function TableHead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
	return (
		<thead className={cn('border-b border-hairline', className)} {...rest}>
			{children}
		</thead>
	)
}

export function TableBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
	return (
		<tbody className={cn('divide-y divide-hairline', className)} {...rest}>
			{children}
		</tbody>
	)
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
	interactive?: boolean
}

export function TableRow({ interactive, className, children, ...rest }: TableRowProps) {
	return (
		<tr
			className={cn('h-8', interactive && 'cursor-pointer transition-colors hover:bg-interact', className)}
			{...rest}
		>
			{children}
		</tr>
	)
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
	numeric?: boolean
}

export function TableHeaderCell({ numeric, className, children, ...rest }: TableHeaderCellProps) {
	return (
		<th
			scope="col"
			className={cn(
				'h-8 whitespace-nowrap px-3 type-label-caps font-semibold text-fg-muted',
				numeric && 'text-right',
				className,
			)}
			{...rest}
		>
			{children}
		</th>
	)
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
	numeric?: boolean
	mono?: boolean
}

export function TableCell({ numeric, mono, className, children, ...rest }: TableCellProps) {
	return (
		<td
			className={cn(
				'h-8 whitespace-nowrap px-3 type-body-md text-fg-secondary',
				numeric && 'text-right',
				(numeric || mono) && 'num text-fg',
				className,
			)}
			{...rest}
		>
			{children}
		</td>
	)
}
