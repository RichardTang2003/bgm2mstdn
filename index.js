import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';

// 加载 .env 文件中的环境变量
dotenv.config();
const {
    BANGUMI_USERNAME, // Bangumi 用户名
    MASTODON_SERVER_URL, // Mastodon 实例地址 (结尾不要带斜杠 /), e.g., 'https://anisage.life'
    MASTODON_ACCESS_TOKEN, // Mastodon 访问令牌 (Access Token)，需要有发布状态的权限 Write:statuses Write:media
    BANGUMI_USER_AGENT, // Bangumi API 推荐设置 User-Agent, 可以不设置，我写了默认 UA
    CRON_SCHEDULE, // 定时任务表达式, e.g., '0 9 * * *' for 9:00 AM daily
    DISABLE_CRON, // 禁用定时任务，设置为 'true' 或 true 时不会启动定时任务
    MAX_ITEMS, // 每次从 Bangumi 获取的最大条目数，默认为 10，防止一次发布太多内容，过早的内容会被舍弃
} = process.env;

const LAST_SYNC_FILE = path.join(process.cwd(), 'last_sync_time.log');

/**
 * 读取上一次同步的最新时间戳
 * @returns {Promise<string|null>}
 */
async function readLastSyncTime() {
    try {
        return await fs.readFile(LAST_SYNC_FILE, 'utf-8');
    } catch (error) {
        // 如果文件不存在，说明是第一次运行
        if (error.code === 'ENOENT') {
            console.log('未找到 last_sync_time.log，将作为首次运行处理。');
            return null;
        }
        throw error;
    }
}

/**
 * 将最新的时间戳写入文件
 * @param {string} timestamp
 */
async function writeLastSyncTime(timestamp) {
    try {
        await fs.writeFile(LAST_SYNC_FILE, timestamp, 'utf-8');
        console.log(`同步时间已更新为: ${timestamp}`);
    } catch (error) {
        console.error('写入 last_sync_time.txt 文件失败:', error);
    }
}

/**
 * 从 Bangumi 获取最近看过的番剧
 * @returns {Promise<Array>}
 */
async function fetchLatestWatchedFromBangumi() {
    if (!BANGUMI_USERNAME) {
        throw new Error('Bangumi 用户名未在 .env 文件中设置');
    }
    const url = `https://api.bgm.tv/v0/users/${BANGUMI_USERNAME}/collections`;
    try {
        console.log('正在从 Bangumi 获取数据...');
        const response = await axios.get(url, {
            params: {
                subject_type: 2, // 1=book, 2=anime, 3=music, 4=game, 6=real
                type: 2,         // 1=想看, 2=看过, 3=在看, 4=搁置, 5=抛弃
                limit: MAX_ITEMS || 10,
                offset: 0,
            },
            headers: {
                'User-Agent': BANGUMI_USER_AGENT || 'bgm2mstdn/1.0',
            },
        });
        console.log('成功获取 Bangumi 数据。');
        return response.data.data;
    } catch (error) {
        console.error('从 Bangumi 获取数据失败:', error.response ? error.response.data : error.message);
        return [];
    }
}

/**
 * 上传图片到 Mastodon 并返回媒体 ID
 * @param {string} imageUrl
 * @returns {Promise<string|null>}
 */
async function uploadMediaToMastodon(imageUrl) {
    if (!MASTODON_SERVER_URL || !MASTODON_ACCESS_TOKEN) {
        throw new Error('Mastodon 服务器地址或访问令牌未在 .env 文件中设置');
    }
    try {
        // 1. 下载图片
        const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // 2. 创建表单并上传
        const form = new FormData();
        form.append('file', imageBuffer, { filename: 'cover.jpg' });

        const uploadUrl = `${MASTODON_SERVER_URL}/api/v2/media`;
        const uploadResponse = await axios.post(uploadUrl, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${MASTODON_ACCESS_TOKEN}`,
            },
        });
        
        // 等待返回的媒体 ID
        if (uploadResponse.status === 202 || !uploadResponse.data.id) {
             console.log('媒体正在处理中，稍后重试获取 ID...');
             await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
             const statusCheckResponse = await axios.get(`${MASTODON_SERVER_URL}/api/v1/media/${uploadResponse.data.id}`, {
                 headers: { 'Authorization': `Bearer ${MASTODON_ACCESS_TOKEN}` }
             });
             return statusCheckResponse.data.id;
        }

        return uploadResponse.data.id;
    } catch (error) {
        console.error('上传媒体到 Mastodon 失败:', error.response ? error.response.data : error.message);
        return null;
    }
}

/**
 * 发布状态到 Mastodon
 * @param {object} item
 * @param {string} mediaId
 */
async function postToMastodon(item, mediaId) {
    const statusUrl = `${MASTODON_SERVER_URL}/api/v1/statuses`;
    
    // 格式化日期和时间
    const updatedAt = new Date(item.updated_at);
    const formattedDate = updatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 构建嘟文内容
    let statusText = `看完一部番！\n\n`;
    statusText += `📺 ${item.subject.name_cn || item.subject.name}\n`;
    statusText += `✅ 完成于: ${formattedDate}\n\n`;
    if (item.comment) {
        statusText += `💬 我的评论:\n${item.comment}\n\n`;
    }
    statusText += `使用[自动化程序](https://github.com/RichardTang2003/bgm2mstdn)同步自 #Bangumi #番剧`;

    try {
        const postData = {
            status: statusText,
            visibility: 'public', // 你可以改为 'unlisted', 'private', 'direct'
        };
        if (mediaId) {
            postData.media_ids = [mediaId];
        }

        await axios.post(statusUrl, postData, {
            headers: {
                'Authorization': `Bearer ${MASTODON_ACCESS_TOKEN}`,
            },
        });
        console.log(`成功发布《${item.subject.name_cn || item.subject.name}》到 Mastodon!`);
    } catch (error) {
        console.error('发布到 Mastodon 失败:', error.response ? error.response.data : error.message);
        throw error; // 抛出错误，防止更新时间戳
    }
}

/**
 * 主函数
 */
async function runSync() {
    console.log(`[${new Date().toLocaleString()}] 开始执行同步任务...`);
    
    const lastSyncTime = await readLastSyncTime();
    const allItems = await fetchLatestWatchedFromBangumi();

    if (!allItems || allItems.length === 0) {
        console.log('未获取到任何番剧信息，任务结束。');
        return;
    }

    // 筛选出比上次同步时间更新的条目
    const newItems = allItems.filter(item => 
        !lastSyncTime || new Date(item.updated_at) > new Date(lastSyncTime)
    );

    if (newItems.length === 0) {
        console.log('没有发现新的已看番剧。');
        return;
    }

    console.log(`发现 ${newItems.length} 个新的已看番剧，准备发布...`);
    
    // API返回的是按更新时间倒序，我们反转数组，按时间正序发布
    // newItems.reverse();

    for (const item of newItems) {
        try {
            const name = item.subject.name_cn || item.subject.name;
            console.log(`正在处理: 《${name}》`);

            // 1. 上传封面
            const imageUrl = item.subject.images?.large;
            let mediaId = null;
            if (imageUrl) {
                mediaId = await uploadMediaToMastodon(imageUrl);
                if (mediaId) {
                    console.log(`图片上传成功, 媒体 ID: ${mediaId}`);
                }
            }

            // 2. 发布嘟文
            await postToMastodon(item, mediaId);

            // 3. 成功发布后，立即更新时间戳，防止重复发送
            await writeLastSyncTime(item.updated_at);
            
            // 在两次发布之间稍作等待，避免请求过于频繁
            await new Promise(resolve => setTimeout(resolve, 5000)); 

        } catch (error) {
            console.error(`处理《${item.subject.name_cn || item.subject.name}》时发生错误，已终止本次同步。`, error.message);
            // 遇到错误就停止，下次运行时会重新尝试
            break; 
        }
    }
    console.log('同步任务完成。');
    
    // 如果禁用了定时任务，完成同步后退出程序
    const isDisableCron = DISABLE_CRON === 'true' || DISABLE_CRON === true;
    if (isDisableCron) {
        console.log('同步完成，程序退出。');
        process.exit(0);
    }
}


console.log('Bangumi-Mastodon 同步脚本已启动。');

// 立即执行一次
runSync();

// 检查是否禁用定时任务
const isDisableCron = DISABLE_CRON === 'true' || DISABLE_CRON === true;

if (isDisableCron) {
    console.log('定时任务已禁用，程序将在完成一次同步后退出。');
} else {
    // 设置定时任务
    const schedule = CRON_SCHEDULE || '0 10 * * *'; // 默认每天上午10点执行
    cron.schedule(schedule, runSync, {
        timezone: "Asia/Shanghai" // 设置时区为中国时间
    });
    
    console.log(`已设置定时任务，每天在 ${schedule} (上海时间) 执行。`);
}
