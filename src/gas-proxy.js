/**
 * Logiris Reader Pro - Article Extraction Proxy
 * 
 * 役割: 
 * 1. Logirisアプリから「記事URL」と「クッキー」を受け取る
 * 2. クッキーを使ってBloombergにアクセスし、フルテキストを取得する
 * 3. 本文だけを抜き出してHTMLとして返す
 */

function doPost(e) {
    return handleRequest(e);
}

function doGet(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    try {
        let url = '';
        let cookies = '';

        // POST (application/x-www-form-urlencoded) または GET パラメータの取得
        if (e.parameter && e.parameter.url) {
            url = e.parameter.url;
            cookies = e.parameter.cookies;
        }
        // JSON POST のフォールバック
        else if (e.postData && e.postData.contents) {
            const params = JSON.parse(e.postData.contents);
            url = params.url;
            cookies = params.cookies;
        }

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

    // Bloombergの本文コンテナを探す（優先順位順）
    let body = '';

    const bodySelectors = [
        '<div[^>]*class="[^"]*body-copy[^"]*"[^>]*>([\\s\\S]*?)<\\/div>',
        '<div[^>]*data-component="article-body"[^>]*>([\\s\\S]*?)<\\/div>',
        '<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\\s\\S]*?)<\\/div>',
        '<article[^>]*>([\\s\\S]*?)<\\/article>'
    ];

    for (const selector of bodySelectors) {
        const match = html.match(new RegExp(selector, 'i'));
        if (match) {
            body = match[1];
            // もし抽出された中身が短すぎる（例: 広告のみ）場合は次を試す
            if (body.length > 500) break;
        }
    }

    if (!body) {
        body = '<p style="color:red">本文の抽出に失敗しました。ロジックの調整が必要です。</p>';
    }

    // 不要な要素のクリーニング
    body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    body = body.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
    body = body.replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');

    // 画像パスの正規化
    body = body.replace(/src="\/([^"]+)"/g, 'src="https://www.bloomberg.com/$1"');
    // アンカータグの無効化（リーダー内での事故防止）
    body = body.replace(/<a /gi, '<span style="color:var(--accent-color)" ');
    body = body.replace(/<\/a>/gi, '</span>');

    return { title, body };
}

function createJsonResponse(data) {
    const output = ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);

    // GASのContentServiceは自動的に CORS: * を付与することが多いですが、明示的に追加を試みます
    return output.addHeader('Access-Control-Allow-Origin', '*');
}
