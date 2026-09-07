import type { BuildingId, Good, Role, TileType } from "../engine/types";

export const ROLE_ZH: Record<Role, string> = {
  settler: "拓荒者",
  mayor: "市長",
  builder: "建築師",
  craftsman: "工匠",
  trader: "商人",
  captain: "船長",
  prospector: "淘金者",
};

export const GOOD_ZH: Record<Good, string> = {
  corn: "玉米",
  indigo: "靛藍",
  sugar: "糖",
  tobacco: "菸草",
  coffee: "咖啡",
};

export const TILE_ZH: Record<TileType, string> = {
  ...GOOD_ZH,
  quarry: "採石場",
};

export const GOOD_TONE: Record<Good | "quarry", string> = {
  corn: "#e2b83a",
  indigo: "#2a4580",
  sugar: "#f3efe4",
  tobacco: "#7a4a24",
  coffee: "#3c2418",
  quarry: "#8b8e93",
};

export function phasePrompt(type: string): string {
  switch (type) {
    case "chooseRole":
      return "選擇本輪角色";
    case "settlerHacienda":
      return "莊園：是否從牌庫再抽一塊種植園？";
    case "settlerTake":
      return "拓荒：拿一塊公開種植園、採石場，或略過";
    case "mayorAssign":
      return "市長：安置殖民者，完成後按確定";
    case "builder":
      return "建築師：購買一座建築，或略過";
    case "craftsmanPrivilege":
      return "工匠特權：可多拿 1 個你剛生產的貨物";
    case "trader":
      return "商人：賣 1 桶貨物到交易屋，或略過";
    case "captainLoad":
      return "船長：把貨物裝上貨船";
    case "captainStore":
      return "船長：選擇倉庫保留的貨物，其餘丟棄";
    case "gameOver":
      return "本局結束";
    default:
      return "等待行動";
  }
}

export function buildingTone(id: BuildingId): "prod" | "violet" | "large" {
  if (id === "guildHall" || id === "residence" || id === "fortress" || id === "customsHouse" || id === "cityHall") {
    return "large";
  }
  if (
    id === "smallIndigo" ||
    id === "smallSugar" ||
    id === "largeIndigo" ||
    id === "largeSugar" ||
    id === "tobaccoStorage" ||
    id === "coffeeRoaster"
  ) {
    return "prod";
  }
  return "violet";
}
