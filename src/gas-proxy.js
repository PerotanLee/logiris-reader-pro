/**
 * Logiris Reader Pro - Article Extraction Proxy
 * 
 * 役割: 
 * 1. Logirisアプリから「記事URL」と「クッキー」を受け取る
 * 2. クッキーを使ってBloombergにアクセスし、フルテキストを取得する
 * 3. 本文だけを抜き出してHTMLとして返す
 */

function doPost(e) {
    try {
        const params = JSON.parse(e.postData.contents);
        const url = params.url;
        const cookies = params.cookies;

        if (!url) {
            return createJsonResponse({ error: 'URL is required' });
        }

        // Bloombergへリクエスト
        const options = {
            method: 'get',
            headers: {
                'Cookie': cookies || '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            muteHttpExceptions: true,
            followRedirects: true
        };

        const response = UrlFetchApp.fetch(url, options);
        const html = response.getContentText();
        const statusCode = response.getResponseCode();

        if (statusCode !== 200) {
            return createJsonResponse({ error: `Fetch failed with status ${statusCode}`, html: html.substring(0, 500) });
        }

        // 本文抽出ロジック（簡易パーサー）
        const articleData = extractBloombergContent(html);

        return createJsonResponse({
            success: true,
            title: articleData.title,
            body: articleData.body,
            url: url
        });

    } catch (err) {
        return createJsonResponse({ error: err.toString() });
    }
}

// CORS対応のためのOPTIONSリクエスト処理
function doOptions(e) {
    return ContentService.createTextOutput("")
        .setMimeType(ContentService.MimeType.TEXT)
        .addHeader('Access-Control-Allow-Origin', '*')
        .addHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        .addHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * BloombergのHTMLから本文を抽出する
 */
function extractBloombergContent(html) {
    let title = '';
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (titleMatch) title = titleMatch[1].replace(/<[^>]*>/g, '').trim();

    // Bloombergの本文コンテナを探す（よく使われるクラス名）
    let body = '';

    // セレクタ候補を順番に試す
    const bodySelectors = [
        '<div[^>]*class="[^"]*body-copy[^"]*"[^>]*>([\\s\\S]*?)<\\/div>',
        '<div[^>]*data-component="article-body"[^>]*>([\\s\\S]*?)<\\/div>',
        '<article[^>]*>([\\s\\S]*?)<\\/article>'
    ];

    for (const selector of bodySelectors) {
        const match = html.match(new RegExp(selector, 'i'));
        if (match) {
            body = match[1];
            break;
        }
    }

    // 万が一見つからない場合は全体を返す（デバッグ用）
    if (!body) {
        body = '<p style="color:red">本文の抽出に失敗しました。ロジックの調整が必要です。</p>';
    }

    // 不要な要素のクリーニング
    body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    body = body.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');

    // 画像パスの正規化（相対パスを絶対パスへ）
    body = body.replace(/src="\/([^"]+)"/g, 'src="https://www.bloomberg.com/$1"');

    return { title, body };
}

function createJsonResponse(data) {
    const output = ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);

    // CORSヘッダーの付加
    return output.addHeader('Access-Control-Allow-Origin', '*');
}
