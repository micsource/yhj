// src/taobao-api.js
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');
const querystring = require('querystring');

// ✅ 修正为淘宝官方生产环境标准网关，旧eco域名GitHub访问超时
const GATEWAY_HOST = 'eco.taobao.com';
const GATEWAY_PATH = '/router/rest';

// 强制IPv4解析，解决GitHub Actions IPv6不通的ENETUNREACH错误
dns.setDefaultResultOrder('ipv4first');

/**
 * 生成淘宝TOP接口MD5签名（大写）
 */
function sign(params, appSecret) {
  const sortedKeys = Object.keys(params)
    .filter(k => params[k] != null && params[k] !== '') // 剔除空值参数
    .sort();
  let raw = appSecret;
  for (const k of sortedKeys) {
    raw += k + params[k];
  }
  raw += appSecret;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * 带重试的TOP接口请求
 */
async function requestTop(method, bizParams, appKey, appSecret, retry = 3) {
  for (let i = 0; i < retry; i++) {
    try {
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

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          host: GATEWAY_HOST,
          path: GATEWAY_PATH,
          method: 'POST',
          timeout: 15000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'Mozilla/5.0 (compatible; TBK-Static-Site/1.0)',
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
          if (json.error_response) {
            // 打印完整错误码和详情，方便排查
            console.log('接口返回错误详情:', JSON.stringify(json.error_response, null, 2));
            const errCode = json.error_response.sub_code || json.error_response.code;
            const errMsg = json.error_response.sub_msg || json.error_response.msg;
            // 仅限流/超时类错误重试，业务错误直接抛出
            if (errMsg.includes('限流') || errMsg.includes('frequency') || errMsg.includes('超时')) {
              reject(new Error('RETRYABLE:' + errMsg));
              } else {
                reject(new Error(`[${errCode}] ${errMsg}`));
              }
            return;
        }

              resolve(json);
            } catch (e) {
              reject(new Error('响应解析失败: ' + data.slice(0, 200)));
            }
          });
        });
        // 网络类错误也标记为可重试
        req.on('error', e => reject(new Error('RETRYABLE:' + e.message)));
        req.on('timeout', () => { req.destroy(); reject(new Error('RETRYABLE:请求超时')); });
        req.write(body);
        req.end();
      });
      return result;
    } catch (e) {
      // ② 非「RETRYABLE」业务错误立即抛出，不再空转重试
      if (i === retry - 1 || !e.message.startsWith('RETRYABLE:')) throw e;
      console.log(`第${i + 1}次请求失败，2秒后重试: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}


// 生成北京时间格式时间戳 yyyy-MM-dd HH:mm:ss
function formatTime(date) {
  const p = n => String(n).padStart(2, '0');
  const bj = new Date(date.getTime() + 8 * 3600 * 1000);
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth()+1)}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}:${p(bj.getUTCSeconds())}`;
}

/**
 * 升级版物料搜索接口拉取商品（27939权限包）
 */
async function getDataFromTaobao(appKey, appSecret, siteId, adzoneId) {
  const res = await requestTop('taobao.tbk.dg.material.recommend', {
    page_size: '20',
    page_no: '1',
    material_id: '28102', // 个人通用高佣爆品池，换品类改这个ID即可
    adzone_id: adzoneId,
    site_id: siteId,
    promotion_type: '2', // 仅返回有优惠券的商品
  }, appKey, appSecret);

  console.log('接口返回商品总数：', res.tbk_dg_material_recommend_response?.total_count || 0);
  const list = res.tbk_dg_material_recommend_response?.result_list?.map_data || [];

  return list.map(item => {
    // 按官方返回结构分层取字段
    const basic = item.item_basic_info || {}; // 基础信息：标题、图片、销量
    const price = item.price_promotion_info || {}; // 价格信息：原价、券后价
    const publish = item.publish_info || {}; // 推广信息：佣金、跳转链接
    const income = publish.income_info || {};

    // 1. 基础字段处理：图片补https前缀
    const title = basic.title || '优惠商品';
    let pictUrl = basic.pict_url || basic.white_image || '';
    if (pictUrl.startsWith('//')) pictUrl = 'https:' + pictUrl;

    // 2. 价格&优惠券计算：直接用返回的数值，不用解析字符串
    const originalPrice = parseFloat(price.zk_final_price || 0);
    const couponPrice = parseFloat(price.final_promotion_price || originalPrice);
    const couponAmount = Math.max(0, (originalPrice - couponPrice).toFixed(1)); // 自动算券面额，不用解析coupon_info

    // 3. 佣金处理：优先用接口返回的预估佣金金额，避免单位计算错误
    const commission = parseFloat(income.commission_amount || 0).toFixed(1);
    const volume = basic.volume || 0;

    // 4. 推广链接补https前缀
    let jumpUrl = publish.coupon_share_url || publish.click_url || '';
    if (jumpUrl.startsWith('//')) jumpUrl = 'https:' + jumpUrl;

    return {
      title,
      pict_url: pictUrl,
      zk_final_price: originalPrice,
      coupon_amount: couponAmount,
      num_iid: item.item_id,
      commission,
      volume,
      coupon_share_url: jumpUrl,
    };
  });
}


module.exports = { getDataFromTaobao };

