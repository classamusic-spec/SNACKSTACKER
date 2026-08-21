import type { ThemeId } from '../core/types';
import type { ThemeCatalog, ThemeDef } from './api';
import { dinerTheme } from './themes/diner';
import { breakfastTheme } from './themes/breakfast';
import { pizzaTheme } from './themes/pizza';
import { sushiTheme } from './themes/sushi';
import { candyTheme } from './themes/candy';
import { tacoTheme } from './themes/taco';

/** Shop order: the free theme first, then the paid ones by appeal. */
const ALL: ThemeDef[] = [
  dinerTheme,
  sushiTheme,
  candyTheme,
  tacoTheme,
  breakfastTheme,
  pizzaTheme,
];

const BY_ID = new Map<ThemeId, ThemeDef>(ALL.map((t) => [t.id, t]));

export const themes: ThemeCatalog = {
  all: ALL,
  byId(id: ThemeId): ThemeDef {
    return BY_ID.get(id) ?? dinerTheme;
  },
  default: dinerTheme,
};

export type { ThemeDef, FoodDef } from './api';
