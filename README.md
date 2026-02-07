# Daily Log (Timeline by Event Name)

一個可直接部署到 GitHub Pages 的純前端日誌程式：
- Google 登入
- Firestore 儲存資料
- 依「事件名稱」自動分組為多條時間軸

## 檔案
- `index.html`: UI
- `styles.css`: 樣式
- `app.js`: Firebase Auth + Firestore 邏輯
- `firestore.rules`: 建議 Firestore 安全規則

## 1) 建立 Firebase 專案
1. 到 Firebase console 建立專案
2. 啟用 `Authentication` -> `Sign-in method` -> `Google`
3. 啟用 `Firestore Database`（建議 Native mode）
4. 建立 Web App，取得 `firebaseConfig`

## 2) 填入前端設定
打開 `app.js`，把 `firebaseConfig` 的 `YOUR_*` 全部換成你的值。

## 3) 設定 Firestore Rules
把 `firestore.rules` 內容貼到 Firebase console 的 Firestore Rules 並發佈。

## 4) 設定授權網域
在 Firebase Auth 的 `Authorized domains` 中加入：
- `localhost`（本機測試）
- `<你的GitHub帳號>.github.io`（GitHub Pages 網域）

如果你用自訂網域，也要再加上自訂網域。

## 5) 本機測試
你可以用任一靜態伺服器，例如：
```bash
npx serve .
```
然後打開顯示網址。

## 6) 部署到 GitHub Pages
這是純靜態網站，可以直接放在 repo root：
1. push 到 GitHub
2. Repo -> Settings -> Pages
3. Source 選 `Deploy from a branch`
4. Branch 選 `main`、資料夾選 `/ (root)`

完成後用 `https://<你的GitHub帳號>.github.io/<repo名>/` 打開。

## 架構說明
資料結構：
- `users/{uid}/events/{eventId}`
  - `name` (string)
  - `description` (string)
  - `occurredAt` (timestamp)
  - `createdAt` (timestamp)

每位使用者只能讀寫自己的 `users/{uid}/events`，用 Google 登入身分控管。

## 可擴充（未實作）
- 新增事件分類色彩
- 篩選時間區間
- 編輯/刪除事件
- 匯出 CSV
