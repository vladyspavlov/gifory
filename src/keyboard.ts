import { Keyboard } from "grammy";
import { TFunction } from "./i18n/index.js";

export function getMainKeyboard(t: TFunction): Keyboard {
  return new Keyboard()
    .text(t("btn_search")).text(t("btn_tags"))
    .row()
    .text(t("btn_communities")).text(t("btn_help"))
    .row()
    .text(t("btn_lang"))
    .resized()
    .persistent();
}
