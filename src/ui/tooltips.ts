import type { BuildingId, Role } from "../engine/types";

export const ROLE_TIP: Record<Role, string> = {
  settler: "依序取得種植園；特權可改拿採石場。",
  mayor: "分配殖民船上的殖民者；特權多拿 1 名殖民者。",
  builder: "依序購買一座建築；特權少付 1 金。",
  craftsman: "所有玩家依已啟用的生產鏈取得貨物；特權多拿 1 個。",
  trader: "依序出售交易屋尚未有的貨物；特權多得 1 金。",
  captain: "輪流把同類貨物裝船並取得勝利分；特權額外得 1 分。",
  prospector: "只有角色持有者獲得 1 金。",
};

export const BUILDING_TIP: Record<BuildingId, string> = {
  smallIndigo: "生產靛藍；每個有人員的圓圈可處理 1 個靛藍。",
  smallSugar: "生產糖；每個有人員的圓圈可處理 1 個糖。",
  largeIndigo: "最多處理 3 個靛藍。",
  largeSugar: "最多處理 3 個糖。",
  tobaccoStorage: "最多處理 3 個菸草。",
  coffeeRoaster: "最多處理 2 個咖啡。",
  smallMarket: "販售貨物時額外獲得 1 金。",
  hacienda: "拓荒時，可先從牌庫頂額外取得 1 塊種植園。",
  constructionHut: "拓荒時可拿採石場，即使不是拓荒者。",
  smallWarehouse: "船長階段結束時，可保留 1 種貨物。",
  hospice: "取得種植園或採石場時，若供應足夠可立即放 1 名殖民者。",
  office: "販售時可忽略交易屋已有同類貨物的限制。",
  largeMarket: "販售貨物時額外獲得 2 金。",
  largeWarehouse: "船長階段結束時，可保留 2 種貨物。",
  factory: "工匠階段依生產的貨物種類數獲得金幣。",
  university: "建造建築時，若供應足夠可立即放 1 名殖民者。",
  harbor: "船長階段每次裝船額外獲得 1 勝利分。",
  wharf: "每輪船長階段可使用一次自己的虛擬貨船。",
  guildHall: "終局：每座小型生產建築 +1 分；大型生產建築 +2 分。",
  residence: "終局：依有人員的種植園與採石場數量加分。",
  fortress: "終局：每 3 名殖民者獲得 1 分。",
  customsHouse: "終局：每 4 枚勝利分籌碼獲得 1 分。",
  cityHall: "終局：每座紫色建築獲得 1 分（含市政廳）。",
};
