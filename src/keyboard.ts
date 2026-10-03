import { Keyboard } from "grammy";
import type { TFunction } from "./i18n/index.js";

export function getMainKeyboard(t: TFunction): Keyboard {
  return new Keyboard().text(t("btn_search")).text(t("btn_communities"))
    .row().text(t("btn_help")).text(t("btn_settings"))
    .resized().persistent();
}
