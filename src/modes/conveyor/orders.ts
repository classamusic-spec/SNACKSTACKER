/**
 * Order generation and the rules for what counts as a right or a wrong grab.
 *
 * An order is at most three ROWS, because three is what a 3.2-unit board can
 * show at a legible size from the belt's far end (see ticket.ts for the
 * arithmetic). Length past three is expressed as a COUNT on a row instead —
 * "TOMATO x2" reads in a glance where a fourth row does not.
 */
import type { FoodDef } from '../../content/api';
import type { Rng } from '../../core/rng';
import { clamp } from '../../core/math';

export interface OrderRow {
  food: FoodDef;
  /** How many of this food the ticket asks for. */
  want: number;
  /** How many have been served. */
  got: number;
}

export interface Order {
  /** 1-based, shown on the docket. */
  number: number;
  rows: OrderRow[];
  /** Total items across every row. */
  total: number;
  /** Total served so far. */
  served: number;
  /** No wrong grab and no missed item since this order started. */
  clean: boolean;
}

/** Rows on the docket at a given level (orders already served). */
export function rowsFor(level: number): number {
  return clamp(1 + Math.floor(level / 2), 1, 3);
}

/** Total items asked for at a given level. */
export function sizeFor(level: number): number {
  const rows = rowsFor(level);
  const extra = clamp(Math.floor((level - 3) / 2), 0, 2);
  return clamp(rows + extra, 1, 5);
}

export function makeOrder(number: number, level: number, foods: FoodDef[], rng: Rng): Order {
  const rowCount = Math.min(rowsFor(level), foods.length);
  const total = Math.max(sizeFor(level), rowCount);

  // Distinct foods, drawn without replacement so no row can duplicate another.
  const bag = foods.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = rng.int(0, i + 1);
    const t = bag[i];
    bag[i] = bag[j];
    bag[j] = t;
  }

  const rows: OrderRow[] = [];
  for (let i = 0; i < rowCount; i++) rows.push({ food: bag[i], want: 1, got: 0 });

  // Spread the surplus one at a time so counts stay flat (2/2/1, never 3/1/1).
  let surplus = total - rowCount;
  let i = 0;
  while (surplus > 0) {
    const row = rows[i % rows.length];
    if (row.want < 3) {
      row.want++;
      surplus--;
    }
    i++;
    if (i > 32) break;
  }

  return { number, rows, total, served: 0, clean: true };
}

/** The row this food would satisfy, or null when the grab is wrong. */
export function rowFor(order: Order, food: FoodDef): OrderRow | null {
  for (let i = 0; i < order.rows.length; i++) {
    const row = order.rows[i];
    if (row.food.id === food.id) return row.got < row.want ? row : null;
  }
  return null;
}

/** True when this food is still outstanding on the ticket. */
export function isWanted(order: Order, food: FoodDef): boolean {
  return rowFor(order, food) !== null;
}

export function isComplete(order: Order): boolean {
  return order.served >= order.total;
}
