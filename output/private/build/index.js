"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const block_basekit_server_api_1 = require("@lark-opdev/block-basekit-server-api");
const { t } = block_basekit_server_api_1.field;
const FEISHU_DOMAINS = ["feishu.cn", "feishucdn.com", "larksuitecdn.com", "larksuite.com"];
const ALIYUN_DOMAINS = ["dashscope.aliyuncs.com", "aliyuncs.com"];
const AUTHORIZATION_ID = "dashscope_api_key";
const SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const TASK_URL_PREFIX = "https://dashscope.aliyuncs.com/api/v1/tasks/";
const REQUEST_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 12 * 60 * 1000;
const DEFAULT_MODEL = "paraformer-v1";
block_basekit_server_api_1.basekit.addDomainList([...FEISHU_DOMAINS, ...ALIYUN_DOMAINS]);
block_basekit_server_api_1.basekit.addField({
    authorizations: [
        {
            id: AUTHORIZATION_ID,
            label: t("authLabel"),
            platform: "base",
            type: block_basekit_server_api_1.AuthorizationType.HeaderBearerToken,
            required: true,
            instructionsUrl: "https://help.aliyun.com/zh/model-studio/get-api-key",
            icon: {
                light: "https://img.alicdn.com/imgextra/i1/O1CN01JdPI5W1g6dhtdP8Hz_!!6000000004096-2-tps-200-200.png",
                dark: "https://img.alicdn.com/imgextra/i1/O1CN01JdPI5W1g6dhtdP8Hz_!!6000000004096-2-tps-200-200.png",
            },
        },
    ],
    i18n: {
        messages: {
            "zh-CN": {
                authLabel: "阿里百炼 API Key",
                attachment: "音频/视频附件",
                result: "extract-text",
            },
            "en-US": {
                authLabel: "Alibaba Bailian API Key",
                attachment: "Audio/Video attachment",
                result: "extract-text",
            },
            "ja-JP": {
                authLabel: "Alibaba Bailian API Key",
                attachment: "音声/動画添付",
                result: "extract-text",
            },
        },
    },
    formItems: [
        {
            key: "attachments",
            label: t("attachment"),
            component: block_basekit_server_api_1.FieldComponent.FieldSelect,
            props: {
                supportType: [block_basekit_server_api_1.FieldType.Attachment],
            },
            validator: {
                required: true,
            },
        },
    ],
    resultType: {
        type: block_basekit_server_api_1.FieldType.Text,
    },
    options: {
        disableAutoUpdate: false,
    },
    execute: async (formItemParams, context) => {
        function createDebugLogger() {
            let step = 0;
            return (label, payload) => {
                step += 1;
                console.log(JSON.stringify({
                    logID: context.logID || "",
                    step,
                    label,
                    payload,
                }), "\n");
            };
        }
        const debugLog = createDebugLogger();
        const fetchWithTimeout = async (url, init, authorizationId, timeoutMs = REQUEST_TIMEOUT_MS) => {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`请求超时: ${timeoutMs}ms`)), timeoutMs);
            });
            const response = await Promise.race([
                context.fetch(url, init, authorizationId),
                timeoutPromise,
            ]);
            const responseText = await response.text();
            debugLog("fetch.response", {
                url,
                status: response.status,
                bodyPreview: responseText.slice(0, 2000),
            });
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const parsedError = JSON.parse(responseText);
                    errorMessage = [parsedError.code, parsedError.message, errorMessage].filter(Boolean).join(" | ");
                }
                catch {
                    if (responseText) {
                        errorMessage = `${errorMessage} | ${responseText.slice(0, 300)}`;
                    }
                }
                throw new Error(errorMessage);
            }
            try {
                return JSON.parse(responseText);
            }
            catch (error) {
                debugLog("fetch.parse_error", {
                    url,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw new Error("接口返回了非 JSON 数据");
            }
        };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const getAttachmentUrl = (attachments) => {
            const firstAttachment = Array.isArray(attachments) ? attachments[0] : undefined;
            return String(firstAttachment?.tmp_url || "").trim();
        };
        const extractTranscriptText = (payload) => {
            const transcriptText = (payload.transcripts || [])
                .map((channel) => {
                if (channel.text && channel.text.trim()) {
                    return channel.text.trim();
                }
                const sentenceText = (channel.sentences || [])
                    .map((sentence) => {
                    if (sentence.text && sentence.text.trim()) {
                        return sentence.text.trim();
                    }
                    return (sentence.words || [])
                        .map((word) => `${word.text || ""}${word.punctuation || ""}`)
                        .join("")
                        .trim();
                })
                    .filter(Boolean)
                    .join("\n");
                return sentenceText.trim();
            })
                .filter(Boolean)
                .join("\n\n")
                .trim();
            return transcriptText;
        };
        const describeError = (message) => {
            const normalized = message.toLowerCase();
            if (normalized.includes("arrearage") || normalized.includes("overdue-payment")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.PayError,
                    hint: "阿里云账号欠费或额度异常，请先检查百炼账户余额、服务开通状态和模型可用额度。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("quota") && normalized.includes("exhaust")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.QuotaExhausted,
                    hint: "阿里云语音识别额度已用尽，请补充额度后重试。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("authorization") || normalized.includes("api key") || normalized.includes("unauthorized")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.AuthorizationError,
                    hint: "API Key 无效、未填写，或当前 API Key 没有访问该模型的权限。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("429") || normalized.includes("rate limit")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.RateLimit,
                    hint: "请求频率过高，请稍后重试。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("timeout") || normalized.includes("请求超时")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.Error,
                    hint: "请求阿里云或拉取结果时超时，请稍后重试。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("transcription_url") ||
                normalized.includes("没有返回结果") ||
                normalized.includes("结果文本为空")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.Error,
                    hint: "阿里云任务执行完成，但没有返回有效的转写文本。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("not in request whitelist") ||
                normalized.includes("getaddrinfo") ||
                normalized.includes("file_url") ||
                normalized.includes("http 404") ||
                normalized.includes("http 403")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.InvalidArgument,
                    hint: "附件地址无法访问，或目标文件链接不合法。请确认文件来自飞书附件字段，或是公网可访问的音视频直链。",
                    userVisibleAsText: true,
                };
            }
            if (normalized.includes("invalid") || normalized.includes("missing")) {
                return {
                    code: block_basekit_server_api_1.FieldCode.InvalidArgument,
                    hint: "请求参数不符合阿里云接口要求，请检查附件字段和输入文件。",
                    userVisibleAsText: true,
                };
            }
            return {
                code: block_basekit_server_api_1.FieldCode.Error,
                hint: "转写失败，请结合任务日志检查阿里云接口返回内容。",
            };
        };
        debugLog("start.v1", {
            formItemParams,
            context: {
                logID: context.logID,
                isNeedPayPack: context.isNeedPayPack,
                hasQuota: context.hasQuota,
            },
        });
        if (context.isNeedPayPack && context.hasQuota === false) {
            return {
                code: block_basekit_server_api_1.FieldCode.FeishuPaidBenefitsExhausted,
            };
        }
        const fileUrl = getAttachmentUrl(formItemParams.attachments);
        if (!fileUrl) {
            debugLog("config_error.missing_attachment_url");
            return {
                code: block_basekit_server_api_1.FieldCode.Success,
                data: "未获取到附件文件地址。请确认已绑定飞书附件字段，并且当前记录中已上传音频或视频文件。",
            };
        }
        try {
            debugLog("submit.request", {
                fileUrl,
                model: DEFAULT_MODEL,
            });
            const submitResponse = await fetchWithTimeout(SUBMIT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-DashScope-Async": "enable",
                },
                body: JSON.stringify({
                    model: DEFAULT_MODEL,
                    input: {
                        file_urls: [fileUrl],
                    },
                    parameters: {
                        channel_id: [0],
                        disfluency_removal_enabled: false,
                        timestamp_alignment_enabled: false,
                    },
                }),
            }, AUTHORIZATION_ID);
            const taskId = String(submitResponse.output?.task_id || "").trim();
            if (!taskId) {
                throw new Error([submitResponse.code, submitResponse.message, "提交转写任务失败，未返回 task_id"].filter(Boolean).join(" | "));
            }
            debugLog("submit.success", {
                taskId,
                taskStatus: submitResponse.output?.task_status,
            });
            const startedAt = Date.now();
            while (Date.now() - startedAt < MAX_POLL_MS) {
                await sleep(POLL_INTERVAL_MS);
                const taskResponse = await fetchWithTimeout(`${TASK_URL_PREFIX}${encodeURIComponent(taskId)}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                }, AUTHORIZATION_ID);
                const taskStatus = String(taskResponse.output?.task_status || "").trim();
                debugLog("task.poll", {
                    taskId,
                    taskStatus,
                });
                if (taskStatus === "PENDING" || taskStatus === "RUNNING") {
                    continue;
                }
                if (taskStatus !== "SUCCEEDED") {
                    throw new Error([taskResponse.code, taskResponse.message, `转写任务失败: ${taskStatus || "UNKNOWN"}`]
                        .filter(Boolean)
                        .join(" | "));
                }
                const result = (taskResponse.output?.results || [])[0];
                if (!result) {
                    throw new Error("转写任务完成，但没有返回结果");
                }
                if (result.subtask_status !== "SUCCEEDED") {
                    throw new Error([result.code, result.message, "文件转写失败"].filter(Boolean).join(" | "));
                }
                const transcriptionUrl = String(result.transcription_url || "").trim();
                if (!transcriptionUrl) {
                    throw new Error("转写任务完成，但没有返回 transcription_url");
                }
                debugLog("transcript.fetch", {
                    taskId,
                    transcriptionUrl,
                });
                const transcriptPayload = await fetchWithTimeout(transcriptionUrl, {
                    method: "GET",
                });
                const transcriptText = extractTranscriptText(transcriptPayload);
                if (!transcriptText) {
                    throw new Error("转写任务完成，但结果文本为空");
                }
                debugLog("success", {
                    taskId,
                    preview: transcriptText.slice(0, 200),
                });
                return {
                    code: block_basekit_server_api_1.FieldCode.Success,
                    data: transcriptText,
                };
            }
            throw new Error("转写任务轮询超时，请稍后重试");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const descriptor = describeError(message);
            debugLog("error", { message, descriptor });
            if (descriptor.userVisibleAsText) {
                return {
                    code: block_basekit_server_api_1.FieldCode.Success,
                    data: descriptor.hint,
                };
            }
            return {
                code: descriptor.code,
            };
        }
    },
});
exports.default = block_basekit_server_api_1.basekit;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxtRkFROEM7QUFFOUMsTUFBTSxFQUFFLENBQUMsRUFBRSxHQUFHLGdDQUFLLENBQUM7QUFFcEIsTUFBTSxjQUFjLEdBQUcsQ0FBQyxXQUFXLEVBQUUsZUFBZSxFQUFFLGtCQUFrQixFQUFFLGVBQWUsQ0FBQyxDQUFDO0FBQzNGLE1BQU0sY0FBYyxHQUFHLENBQUMsd0JBQXdCLEVBQUUsY0FBYyxDQUFDLENBQUM7QUFFbEUsTUFBTSxnQkFBZ0IsR0FBRyxtQkFBbUIsQ0FBQztBQUM3QyxNQUFNLFVBQVUsR0FBRyx3RUFBd0UsQ0FBQztBQUM1RixNQUFNLGVBQWUsR0FBRyw4Q0FBOEMsQ0FBQztBQUN2RSxNQUFNLGtCQUFrQixHQUFHLEtBQU0sQ0FBQztBQUNsQyxNQUFNLGdCQUFnQixHQUFHLElBQUssQ0FBQztBQUMvQixNQUFNLFdBQVcsR0FBRyxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQztBQUNuQyxNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUM7QUErRHRDLGtDQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsR0FBRyxjQUFjLEVBQUUsR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDO0FBRTlELGtDQUFPLENBQUMsUUFBUSxDQUFDO0lBQ2YsY0FBYyxFQUFFO1FBQ2Q7WUFDRSxFQUFFLEVBQUUsZ0JBQWdCO1lBQ3BCLEtBQUssRUFBRSxDQUFDLENBQUMsV0FBVyxDQUFDO1lBQ3JCLFFBQVEsRUFBRSxNQUFNO1lBQ2hCLElBQUksRUFBRSw0Q0FBaUIsQ0FBQyxpQkFBaUI7WUFDekMsUUFBUSxFQUFFLElBQUk7WUFDZCxlQUFlLEVBQUUscURBQXFEO1lBQ3RFLElBQUksRUFBRTtnQkFDSixLQUFLLEVBQUUsOEZBQThGO2dCQUNyRyxJQUFJLEVBQUUsOEZBQThGO2FBQ3JHO1NBQ0Y7S0FDRjtJQUNELElB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