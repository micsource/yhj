// src/taobao-api.js
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

// 淘宝 TOP 网关地址
const GATEWAY = 'https://eco.taobao.com/router/rest';

/**
 * 生成淘宝 TOP 接口签名（MD5 大写）
 */
function sign(params, appSecret) {
  // 1. 按参数名 ASCII 升序排列
  const sortedKeys = Object.keys(params).sort();
  // 2. 拼接 key=value，首尾各加 appSecret
  let raw = appSecret;
  for (const k of sortedKeys) {
    raw += k + params[k];
  }
  raw += appSecret;
  // 3. MD5 后转大写
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * 通用 TOP 接口请求方法
 * @param {string} method 接口名，如 taobao.tbk.item.recommend.get
 * @param {object} bizParams 业务参数
 * @param {string} appKey
 * @param {string} appSecret
 */
function requestTop(method, bizParams, appKey, appSecret) {
  const publicParams = {
    method,
    app_key: appKey,
    timestamp: formatTime(new Date()),
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
  };
  const allParams = { ...publicParams, ...bizParams };
  allParams.sign = sign(allParams, appSecret);

  const body = querystring.stringify(allParams);

  return new Promise((resolve, reject) => {
    const req = https.request(GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // 接口报错时抛异常
          if (json.error_response) {
            reject(new Error(json.error_response.sub_msg || json.error_response.msg));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(new Error('响应解析失败: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 淘宝要求时间格式 yyyy-MM-dd HH:mm:ss（北京时间）
function formatTime(date) {
  const p = n => String(n).padStart(2, '0');
  // 转北京时间 UTC+8
  const bj = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ` +
         `${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}:${p(bj.getUTCSeconds())}`;
}

/**
 * 拉取淘宝客高佣商品列表核心封装
 */
async function getDataFromTaobao(appKey, appSecret, adzoneId) {
  const res = await requestTop('taobao.tbk.item.recommend.get', {
    adzone_id: adzoneId,
    page_no: 1,
    page_size: 100,
    sort: 'total_sales_des',
    platform: 2,
  }, appKey, appSecret);

  // 返回值字段对齐你前端渲染脚本（pict_url / zk_final_price / coupon_amount / commission_rate）
  const list = res.tbk_item_recommend_get_response?.result?.results?.n_tbk_item || [];
  return list.map(item => ({
    title: item.title,
    pict_url: item.pict_url,
    zk_final_price: item.zk_final_price,
    coupon_amount: item.coupon_amount || 0,
    num_iid: item.num_iid,
    commission_rate: item.commission_rate,
    volume: item.volume,
  }));
}

module.exports = { getDataFromTaobao, requestTop, sign };
