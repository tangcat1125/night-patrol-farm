# 夜巡農場對談資料

`animals/` 每隻動物一份 JSON，收錄一般、恐慌、受傷和治療後的台詞。

`branches.json` 是兩條故事線的規則：

- `defense`：取得可查證的狼群入口，啟動狗的快速巡邏與烏鴉的空中牽制。
- `truth`：先取得信鴿的昨夜行蹤、鴨子的池塘怪影、烏鴉的空中足跡，才能讓黑鼻羊坦白。

每段 `conversations` 可設定 `requires`（先決證據）、`grants`（新線索或守備能力）和 `nextCharacter`（導引下一位角色）。遊戲會優先顯示尚未聽過、且條件已滿足的對談。沒有線索時，野狼從農場外圍隨機出現；取得入口線索後，夜間會從已查明的入口出現。

GitHub Pages 會直接讀這些 JSON。直接以 `index.html` 離線開啟時，瀏覽器禁止讀取本機 JSON，因此遊戲使用同資料的 `bundle.js`。編輯 JSON 後，在專案根目錄執行 `node dialogues/build-bundle.cjs` 更新離線副本，再發布。
