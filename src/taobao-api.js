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
                const errMsg = json.error_response.sub_msg || json.error_response.msg;
                // ① 只有限流/超时类错误才标记为可重试
                if (errMsg.includes('限流') || errMsg.includes('frequency') || errMsg.includes('超时')) {
                  reject(new Error('RETRYABLE:' + errMsg));
                } else {
                  reject(new Error(errMsg));
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
async function getDataFromTaobao(appKey, appSecret, adzoneId) {
  const res = await requestTop('taobao.tbk.dg.material.optional.upgrade', {
    adzone_id: adzoneId,
    page_no: 1,
    page_size: 50,
    sort: 'total_sales_des',
    has_coupon: 'true',
    start_tk_rate: '1000', // 最低佣金10%
    q: '高佣爆款', // ✅ 补上这行搜索关键词，或者传cat类目ID，二选一即可
  }, appKey, appSecret);

  console.log('接口返回成功，开始解析商品数据');
  const list = res.tbk_dg_material_optional_upgrade_response?.result_list?.map_data || [];

  return list.map(item => {
    const income = item.income_info || {};
    // 解析优惠券面额
    let couponAmount = 0;
    if (item.coupon_info) {
      const match = item.coupon_info.match(/减(\d+(?:\.\d+)?)元/);
      couponAmount = match ? parseFloat(match[1]) : 0;
    }
    const originalPrice = parseFloat(item.zk_final_price || 0);
    const couponPrice = (originalPrice - couponAmount).toFixed(1);
    // 升级版佣金单位是万分之一
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
      coupon_share_url: item.coupon_share_url || item.url,
    };
  });
}

module.exports = { getDataFromTaobao };

