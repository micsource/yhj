// src/fetch_goods.js
const fs = require('fs');
const path = require('path');
const { getDataFromTaobao } = require('./taobao-api');

// 简单 HTML 转义，防止标题里的特殊字符破坏页面结构
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function main() {
    console.log('开始拉取淘宝客商品数据...');

    // 1. 获取环境变量中的密钥（在 GitHub Settings -> Secrets 中配置）
    const appKey = process.env.TB_APP_KEY;
    const appSecret = process.env.TB_APP_SECRET;
    const adzoneId = process.env.TB_ADZONE_ID;

    if (!appKey || !appSecret) {
        throw new Error('缺少必要的环境变量 TB_APP_KEY 或 TB_APP_SECRET');
    }

    // 2. 调用淘宝联盟接口获取商品
    const goodsList = await getDataFromTaobao(appKey, appSecret, adzoneId);
    console.log(`成功获取 ${goodsList.length} 个商品`);

    // 3. 生成商品卡片 HTML
    const goodsHtml = goodsList.map(item => {
        const originalPrice = parseFloat(item.zk_final_price || 0);
        const couponAmount = parseFloat(item.coupon_amount || 0);
        const finalPrice = (originalPrice - couponAmount).toFixed(1);
        const title = escapeHtml(item.title);

        return `
    <div class="goods-card">
        <a href="${item.coupon_share_url}" target="_blank" rel="nofollow">
            <img class="goods-img" src="${item.pict_url}" alt="${title}" loading="lazy">
            <div class="goods-info">
                <div class="goods-title">${title}</div>
                <div class="price-row">
                    <span class="coupon-price">¥${finalPrice}</span>
                    <span class="original-price">¥${originalPrice.toFixed(1)}</span>
                    ${couponAmount > 0 ? `<span class="coupon-tag">${couponAmount}元券</span>` : ''}
                </div>
                <div class="commission-row">
                    <span>销量 ${item.volume || 0}</span>
                    <span class="commission">预估赚 ¥${item.commission || 0}</span>
                </div>
            </div>
        </a>
    </div>`;
    }).join('\n');

    // 4. 读模板、替换占位符、输出到仓库根目录
    const templatePath = path.join(__dirname, 'template.html');
    const outputPath = path.join(__dirname, '..', 'index.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');

    htmlContent = htmlContent.replace(
        '<!-- GOODS_LIST -->',
        () => goodsHtml || '<div class="empty">暂无商品数据</div>'
    );

    fs.writeFileSync(outputPath, htmlContent);
    console.log('HTML 生成完毕，商品数：', goodsList.length);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
