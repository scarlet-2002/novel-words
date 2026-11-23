# 小说单词 Novel Words

记录读小说时遇到的生词，按艾宾浩斯遗忘曲线分两阶段复习，每日打卡。网页 App（PWA），Mac 和 iPhone 都能「安装」使用，断网也能录入和复习。

- **录入**：按自定义 Section（如一本书）组织；可粘贴书中原句。
- **自动释义**：Free Dictionary API → Wiktionary → Datamuse 依次查询，取最主要的 1–3 个义项和例句；中文语境模式下用 MyMemory 免费翻译成中文。断网时先存为「等待生成」，联网后自动补全。
- **两阶段复习**：阶段1 看词 → 熟悉 / 一般 / 陌生 → 看释义；阶段2 例句挖空（优先用你的原句）→ 打字或「不知道」。默认连续 3 次「熟悉」后进入阶段2，阶段2 连续 2 次答错退回阶段1。也可选「全部看词识意」或「全部看句填空」。
- **间隔**：0 / 1 / 2 / 4 / 7 / 15 / 30 / 60 天。
- **打卡**：完成每日目标或清空当日待复习即打卡；打卡日历、连续天数、App 图标角标、苹果日历每日提醒。
- **查找**：拼写/中英文意思模糊搜索 + 近义词搜索。
- **同步**：Supabase（免费）邮箱 + 密码登录，Mac 和 iPhone 自动同步。

不需要安装 Node 或任何构建工具，整个文件夹就是网站。

---

## 1. 配置同步（Supabase，约 5 分钟）

不配置也能用，但数据只存在各自设备的浏览器里。

1. 在 <https://supabase.com> 注册，**New project**（区域选离你近的，密码随意记下）。
2. 打开 **SQL Editor → New query**，把 `supabase/schema.sql` 的全部内容粘贴进去，点 **Run**。
3. **登录方式是「邮箱 + 密码」，不用改任何邮件模板。** 二选一：
   - **最省事**：打开 **Authentication → Sign In / Providers → Email**，关掉 **Confirm email**，保存。之后在 App 里注册完就直接登录，不会收到任何邮件。
   - **保留邮箱确认**：什么都不用改。在 App 里注册后会收到一封 “Confirm your email address” 邮件，点一次里面的链接即可（链接跳转的页面打不开也没关系，确认已经生效），然后回到 App 登录。建议先在 **Authentication → URL Configuration** 把 **Site URL** 改成你的 GitHub Pages 网址，这样链接会跳回 App。
4. 打开 **Project Settings → API**，复制 **Project URL** 和 **anon public** key，填进 `js/config.js`：
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   anon key 本来就是公开的，数据靠数据库的行级权限（RLS）保护，每个人只能读写自己的数据。

## 2. 部署到 GitHub Pages（免费 HTTPS）

1. 在 GitHub 新建一个仓库（如 `novel-words`），把本文件夹里的所有文件上传到仓库根目录（网页上 **Add file → Upload files** 拖进去即可）。
2. 仓库 **Settings → Pages → Build and deployment**：Source 选 **Deploy from a branch**，Branch 选 `main` / `/ (root)`，保存。
3. 一两分钟后网址为 `https://<你的用户名>.github.io/novel-words/`。

以后修改代码：重新上传改动的文件即可。如果改了文件后手机上没更新，可把 `sw.js` 第一行的 `VERSION` 改个数字（如 `nv-v2`）再上传。

## 3. 安装到设备

- **iPhone**：用 Safari 打开网址 → 分享 → **添加到主屏幕**。
- **Mac**：Safari 打开网址 → 菜单 **文件 → 添加到程序坞**。
- 在 **设置** 页第一次点「注册」创建账号，之后两台设备都用同一个邮箱和密码「登录」，数据自动同步。
- **每日提醒**：设置 → 选时间 → 添加提醒到日历（生成一个每天重复的苹果日历事件，iCloud 会同步到两台设备）。
- **图标角标**：设置 → 勾选「在 App 图标上显示待复习数」（iPhone 需 iOS 16.4+ 且已添加到主屏幕）。

## 本地运行 / 测试

```bash
python3 -m http.server 8765
```

然后打开 <http://localhost:8765>。复习算法和填空判定的单元测试：<http://localhost:8765/tests.html>。

## 免费 API 的限制

- MyMemory 匿名每天约 5000 字符（约 10–15 个词的释义+例句翻译）。用完后中文会在第二天继续补全；在设置里填一个邮箱可提升到每天 5 万字符。
- Free Dictionary API 对部分短语和专有名词没有结果，会自动改查 Wiktionary；都查不到时可在单词详情里手动添加释义。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `js/srs.js` | 艾宾浩斯间隔复习、阶段升降 |
| `js/cloze.js` | 例句挖空、词形变化匹配、答案判定 |
| `js/enrich.js` | 释义/例句/翻译/近义词生成队列（离线排队） |
| `js/sync.js` + `supabase/schema.sql` | 本地优先存储与 Supabase 双向同步 |
| `js/checkin.js` | 打卡、连续天数、日历提醒 |
| `js/pages.js` / `js/review.js` | 界面 |
| `js/i18n.js` | 全英文 / 中文语境两套文案 |
| `sw.js` | 离线缓存 |
