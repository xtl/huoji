const message = [
  "客户等报价，你还在翻群？",
  "昨天明明看见有人出 H200，今天客户一问，才发现连哪个群都记不住。手里有货时也一样，想找前两天问过的人，半天翻不出来。",
  "可以拿一个常看的群试试货记。电脑上选好群，它会自动翻聊天，把出货和求购分开整理。以后想找货、找买家，先搜型号。群里没找到，还能去内圈看看，遇到合适的直接聊。",
  "https://huoij.com/about/",
].join("\n\n");

document.querySelector("#share").addEventListener("click", async () => {
  const status = document.querySelector("#share-status");
  try {
    await navigator.clipboard.writeText(message);
    status.textContent = "已复制，可以粘贴到微信群或朋友圈。";
  } catch {
    const field = document.createElement("textarea");
    field.value = message;
    field.readOnly = true;
    field.setAttribute("aria-label", "微信推广文案");
    status.replaceChildren("请长按或手动复制下方文案。", field);
    field.focus();
    field.select();
  }
});
