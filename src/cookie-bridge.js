/**
 * Cookie Bridge Utility for Logiris Reader Pro
 * This script manages the bookmarklet and local session persistence for Bloomberg full-text extraction.
 */

export const CookieBridge = {
    LS_KEY: 'logiris_bloomberg_cookies',

    /**
     * Returns a robust diagnostic bookmarklet code.
     * It looks for session-related cookies and provides a fallback if none are found.
     */
    getBookmarkletCode() {
        return 'javascript:(function(){const d=window.location.hostname;if(!d.includes("bloomberg.com")&&!d.includes("bloomberg.co.jp")){alert("Bloombergのサイト上で実行してください (現在のドメイン: "+d+")");return;}const c=document.cookie.split("; ");const f=c.filter(x=>{const k=x.split("=")[0].toLowerCase();return k.includes("session")||k.includes("auth")||k.includes("token")||k.includes("login")});if(c.length===0){alert("ブラウザからクッキーが一つも見つかりませんでした。プライベートモードや制限がかかっていないか確認してください。");}else if(f.length===0){const all=c.map(x=>x.split("=")[0]).join(", ");prompt("セッション用クッキーを特定できませんでした。以下の中からそれらしいものを選んでコピーするか、すべてコピーして貼り付けてください:\\n\\n"+all, c.join("; "));}else{prompt("Bloombergのログイン情報を抽出しました。これをコピーして、Logirisの設定欄に貼り付けてください:", f.join("; "));}})();';
    },

    /**
     * Saves the provided cookie string to localStorage
     */
    saveCookies(cookieStr) {
        if (!cookieStr) return;
        localStorage.setItem(this.LS_KEY, cookieStr.trim());
    },

    /**
     * Retrieves the saved cookies from localStorage
     */
    getSavedCookies() {
        return localStorage.getItem(this.LS_KEY) || '';
    },

    /**
     * Clears the cookies from localStorage
     */
    clearCookies() {
        localStorage.removeItem(this.LS_KEY);
    }
};
