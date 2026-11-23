// src/fetch_goods.js
const fs = require('fs');
const path = require('path');
// 如果使用官方 TOP SDK 或 axios，需先在 package.json 中添加依赖
// const axios = require('axios'); 

async function main() {
    console.log('开始拉取淘宝客商品数据...');
    
    // 1. 获取环境变量中的密钥 (在 GitHub Settings -> Secrets 中配置)
    const appKey = process.env.TB_APP_KEY;
    const appSecret = process.env.TB_APP_SECRET;
    const adzoneId = process.env.TB_ADZONE_ID;

    if (!appKey || !appSecret) {
        throw new Error('缺少必要的环境变量 TB_APP_KEY 或 TB_APP_SECRET');
    }

    // 2. 模拟调用 API 获取数据 
    // 实际项目中，这里应使用 top-sdk-node 或自行实现签名请求调用 taobao.tbk.item.recommend.get
    // 此处为伪代码示例，假设 getDataFromTaobao 是你封装好的请求函数
    // const goodsList = await getDataFromTaobao(appKey, appSecret, adzoneId);
   /* 
    // 为了演示，这里生成一些 mock 数据
    const goodsList = [
        {
            title: "测试商品1",
            pict_url: "https://via.placeholder.com/300",
            zk_final_price: "9.9",
            coupon_amount: "5",
            num_iid: "123456",
            commission_rate: "1000"
        },
        {
            title: "测试商品2",
            pict_url: "https://via.placeholder.com/300",
            zk_final_price: "19.9",
            coupon_amount: "10",
            num_iid: "789012",
            commission_rate: "1500"
        }
    ];
*/
    const { getDataFromTaobao } = require('./taobao-api');

// ...中间省略

// 原来那行伪代码改为：
const goodsList = await getDataFromTaobao(appKey, appSecret, adzoneId);
    console.log(`成功获取 ${goodsList.length} 个商品`);

    // 3. 读取 HTML 模板
    const templatePath = path.join(__dirname, 'template.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf-8');

    // 4. 渲染数据到 HTML
    // 简单替换示例：在实际生产中，建议使用 ejs, handlebars 等模板引擎
    const goodsHtml = goodsList.map(item => {
        const finalPrice = (parseFloat(item.zk_final_price) - parseFloat(item.coupon_amount)).toFixed(1);
        return `
        <div class="goods-card">
            <img src="${item.pict_url}" alt="${item.title}">
            <h3>${item.title}</h3>
            <p>券后价: ¥${finalPrice}</p>
            <a href="https://s.click.taobao.com/t?e=m%3D2%26s=${item.num_iid}%26pid=${adzoneId}" target="_blank">立即领券</a>
        </div>
        `;
    }).join('');

    // 假设模板中有一个 <!-- GOODS_LIST --> 占位符
    htmlContent = htmlContent.replace('<!-- GOODS_LIST -->', goodsHtml);

    // 5. 输出最终 HTML 到根目录或 dist 目录
    const outputPath = path.join(__dirname, '..', 'index.html');
    fs.writeFileSync(outputPath, htmlContent);
    console.log('HTML 文件生成完毕:', outputPath);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
