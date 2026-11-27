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
 * 拉取淘宝客高佣商品列表（官方现行通用物料搜索接口）
 */
async function getDataFromTaobao(appKey, appSecret, adzoneId) {
  const res = await requestTop('taobao.tbk.dg.material.optional.upgrade', {
    adzone_id: adzoneId,
    page_no: 1,
    page_size: 50,
    sort: 'total_sales_des',
    has_coupon: 'true',
    start_tk_rate: '1000',
  }, appKey, appSecret);

  // 升级版真实返回路径，字段全部校准
  const list = res.tbk_dg_material_optional_upgrade_response?.result_list?.map_data || [];
  
  return list.map(item => {
    const income = item.income_info || {};
    // 券信息解析兼容新旧格式
    let couponAmount = 0;
    if (item.coupon_info) {
      const match = item.coupon_info.match(/减(\d+(?:\.\d+)?)元/);
      couponAmount = match ? parseFloat(match[1]) : 0;
    }
    const originalPrice = parseFloat(item.zk_final_price || 0);
    const couponPrice = (originalPrice - couponAmount).toFixed(1);
    // 佣金计算
    const commissionRate = parseInt(income.commission_rate || item.commission_rate || 0);
    const commission = (couponPrice * commissionRate / 10000).toFixed(1);

    return {
      title: item.title,
      pict_url: item.pict_url,
      zk_final_price: originalPrice,
      coupon_amount: couponAmount,
      num_iid: item.item_id,
      commission_rate: commissionRate,
      commission: commission,
      volume: item.volume || 0,
      // 直接用接口返回的转链结果，不需要手动拼接s.click链接
      coupon_share_url: item.coupon_share_url || item.url,
    };
  });
}



// 解析券面额（新版接口券信息是字符串格式，需要提取数字）
function parseCouponAmount(couponInfo) {
  const match = couponInfo.match(/减(\d+(?:\.\d+)?)元/);
  return match ? parseFloat(match[1]) : 0;
}


module.exports = { getDataFromTaobao, requestTop, sign };
