"""Exact standalone WeChat window names accepted by the collector and server."""
import re


def valid_group_name(value):
    return (isinstance(value, str) and bool(value) and value == value.strip()
            and len(value.encode("utf-16-le", errors="surrogatepass")) <= 400
            and not re.search(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]", value)
            and value.lower() not in {"微信", "wechat", "weixin"})
