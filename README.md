# 旅日語

以旅行行程為主軸的日語學習網站。每個行程按天排出景點、餐廳、店家、交通和飯店，每一站都有情境對話、菜單和單字，單字表內含閃卡、對話填空和聽力練習。

純前端靜態網站，不需要建置工具，放上 GitHub Pages 就能用。

## 開啟 GitHub Pages

repo 的 **Settings → Pages → Build and deployment**：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾 `/ (root)`，按 Save。一兩分鐘後網址會出現在同一頁。

## 學習記錄

完成狀態、單字熟悉度、筆記都存在瀏覽器的 localStorage，不會上傳到任何地方。換裝置或清除瀏覽資料前，到「切換行程」頁匯出記錄（JSON 檔），在另一台裝置匯入即可。匯入可選「合併」（同一筆保留較新的）或「覆蓋」。

本機測試要用伺服器開啟（直接點開 index.html 會讀不到資料）：

```
python3 -m http.server
```

## 檔案結構

```
index.html
css/style.css
js/app.js
data/index.json            行程清單
data/trips/<id>.json       各行程的內容
```

## 資料格式

`data/index.json`

```json
{ "trips": [ { "id": "kyoto-2026", "name": "京都五天", "region": "京都", "startDate": "2026-12-15", "days": 5, "file": "data/trips/kyoto-2026.json" } ], "books": [] }
```

`data/trips/<id>.json`

- `days[].steps[]`：當天依順序排列的步驟
  - `{ "kind": "stop", "type": "spot" | "restaurant" | "shop", "label": "午餐", "places": ["placeId", ...] }`：同一站有多個候選就放多個 place
  - `{ "kind": "move", "mode": "電車", "line": "...", "from": "...", "to": "...", "detail": "...", "place": "placeId" }`：`place` 可省略，有的話可以點進去練交通情境
  - `{ "kind": "hotel", "place": "placeId", "night": "第 1 晚／共 2 晚" }`
- `places.<id>`：`type`、`name`、`kana`、`zh`、`scenarios`、`menu`（餐廳才有）、`vocab`（單字 id 陣列）
  - `scenarios[]`：`{ "id", "title", "staff": "店員", "ok": [台詞...], "ng": [台詞...] }`，`ng` 是出狀況版，可省略
  - 台詞：`{ "who": "me" | "staff", "ja": "{予約|よやく}してないんですけど…", "zh": "...", "note": "語感註解" }`，`{漢字|かな}` 會顯示成振假名
  - `menu`：`{ "title", "sections": [ { "title", "items": [ { "id", "ja", "price", "v": "單字 id" } ] } ] }`
- `vocab.<id>`：`{ "ja", "kana", "zh", "cat": "menu" | "place" | "talk" | "transit" | "shop", "note", "unverified": true }`

學習記錄用「單字＋讀音」和「行程:地點:情境」當作 key，所以修改或新增內容不會打亂既有記錄；但改動已存在項目的 id 會讓那一筆記錄對不上。
