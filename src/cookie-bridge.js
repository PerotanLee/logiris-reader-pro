/**
 * Cookie Bridge Utility for Logiris Reader Pro
 * This script manages the bookmarklet and local session persistence for Bloomberg full-text extraction.
 */

export const CookieBridge = {
    LS_KEY: 'logiris_bloomberg_cookies',

    /**
     * Returns the bookmarklet code that the user should run on bloomberg.com
     * to copy their session cookies.
     */
    getBookmarkletCode() {
        return 'javascript:(function(){const c=document.cookie.split("; ").filter(x=>x.startsWith("exp_last_session")||x.startsWith("p_session_id"));if(c.length===0){alert("Bloombergのセッションクッキーが見つかりません。ログインしているか確認してください。");}else{const s=c.join("; ");prompt("以下のクッキーをコピーして、Logirisの設定欄に貼り付けてください:",s);}})();';
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
