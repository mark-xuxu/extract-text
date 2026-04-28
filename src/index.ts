import {
  AuthorizationType,
  basekit,
  FieldCode,
  FieldComponent,
  type FieldContext,
  FieldType,
  field,
} from "@lark-opdev/block-basekit-server-api";

const { t } = field;

const FEISHU_DOMAINS = ["feishu.cn", "feishucdn.com", "larksuitecdn.com", "larksuite.com"];
const ALIYUN_DOMAINS = ["dashscope.aliyuncs.com", "aliyuncs.com"];

const AUTHORIZATION_ID = "dashscope_api_key";
const SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const TASK_URL_PREFIX = "https://dashscope.aliyuncs.com/api/v1/tasks/";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_MS = 12 * 60 * 1000;
const DEFAULT_MODEL = "paraformer-v1";

type AttachmentFieldValue = Array<{
  name?: string;
  size?: number;
  type?: string;
  tmp_url?: string;
}>;

interface DashScopeSubmitResponse {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
  };
}

interface DashScopeTaskResult {
  file_url?: string;
  transcription_url?: string;
  subtask_status?: string;
  code?: string;
  message?: string;
}

interface DashScopeTaskResponse {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: DashScopeTaskResult[];
  };
}

interface DashScopeTranscriptWord {
  text?: string;
  punctuation?: string;
}

interface DashScopeTranscriptSentence {
  text?: string;
  words?: DashScopeTranscriptWord[];
}

interface DashScopeTranscriptChannel {
  text?: string;
  sentences?: DashScopeTranscriptSentence[];
}

interface DashScopeTranscriptPayload {
  transcripts?: DashScopeTranscriptChannel[];
}

interface ErrorDescriptor {
  code: FieldCode;
  hint: string;
  userVisibleAsText?: boolean;
}

basekit.addDomainList([...FEISHU_DOMAINS, ...ALIYUN_DOMAINS]);

basekit.addField({
  authorizations: [
    {
      id: AUTHORIZATION_ID,
      label: t("authLabel"),
      platform: "base",
      type: AuthorizationType.HeaderBearerToken,
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
      component: FieldComponent.FieldSelect,
      props: {
        supportType: [FieldType.Attachment],
      },
      validator: {
        required: true,
      },
    },
  ],
  resultType: {
    type: FieldType.Text,
  },
  options: {
    disableAutoUpdate: false,
  },
  execute: async (
    formItemParams: {
      attachments?: AttachmentFieldValue;
    },
    context: FieldContext,
  ) => {
    function createDebugLogger() {
      let step = 0;
      return (label: string, payload?: unknown) => {
        step += 1;
        console.log(
          JSON.stringify({
            logID: context.logID || "",
            step,
            label,
            payload,
          }),
          "\n",
        );
      };
    }

    const debugLog = createDebugLogger();

    const fetchWithTimeout = async <T>(
      url: string,
      init?: RequestInit,
      authorizationId?: string,
      timeoutMs = REQUEST_TIMEOUT_MS,
    ): Promise<T> => {
      const timeoutPromise = new Promise<never>((_, reject) => {
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
          const parsedError = JSON.parse(responseText) as { message?: string; code?: string };
          errorMessage = [parsedError.code, parsedError.message, errorMessage].filter(Boolean).join(" | ");
        } catch {
          if (responseText) {
            errorMessage = `${errorMessage} | ${responseText.slice(0, 300)}`;
          }
        }
        throw new Error(errorMessage);
      }

      try {
        return JSON.parse(responseText) as T;
      } catch (error) {
        debugLog("fetch.parse_error", {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error("接口返回了非 JSON 数据");
      }
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const getAttachmentUrl = (attachments?: AttachmentFieldValue) => {
      const firstAttachment = Array.isArray(attachments) ? attachments[0] : undefined;
      return String(firstAttachment?.tmp_url || "").trim();
    };

    const extractTranscriptText = (payload: DashScopeTranscriptPayload) => {
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

    const describeError = (message: string): ErrorDescriptor => {
      const normalized = message.toLowerCase();
      if (normalized.includes("arrearage") || normalized.includes("overdue-payment")) {
        return {
          code: FieldCode.PayError,
          hint: "阿里云账号欠费或额度异常，请先检查百炼账户余额、服务开通状态和模型可用额度。",
          userVisibleAsText: true,
        };
      }
      if (normalized.includes("quota") && normalized.includes("exhaust")) {
        return {
          code: FieldCode.QuotaExhausted,
          hint: "阿里云语音识别额度已用尽，请补充额度后重试。",
          userVisibleAsText: true,
        };
      }
      if (normalized.includes("authorization") || normalized.includes("api key") || normalized.includes("unauthorized")) {
        return {
          code: FieldCode.AuthorizationError,
          hint: "API Key 无效、未填写，或当前 API Key 没有访问该模型的权限。",
          userVisibleAsText: true,
        };
      }
      if (normalized.includes("429") || normalized.includes("rate limit")) {
        return {
          code: FieldCode.RateLimit,
          hint: "请求频率过高，请稍后重试。",
          userVisibleAsText: true,
        };
      }
      if (normalized.includes("timeout") || normalized.includes("请求超时")) {
        return {
          code: FieldCode.Error,
          hint: "请求阿里云或拉取结果时超时，请稍后重试。",
          userVisibleAsText: true,
        };
      }
      if (
        normalized.includes("transcription_url") ||
        normalized.includes("没有返回结果") ||
        normalized.includes("结果文本为空")
      ) {
        return {
          code: FieldCode.Error,
          hint: "阿里云任务执行完成，但没有返回有效的转写文本。",
          userVisibleAsText: true,
        };
      }
      if (
        normalized.includes("not in request whitelist") ||
        normalized.includes("getaddrinfo") ||
        normalized.includes("file_url") ||
        normalized.includes("http 404") ||
        normalized.includes("http 403")
      ) {
        return {
          code: FieldCode.InvalidArgument,
          hint: "附件地址无法访问，或目标文件链接不合法。请确认文件来自飞书附件字段，或是公网可访问的音视频直链。",
          userVisibleAsText: true,
        };
      }
      if (normalized.includes("invalid") || normalized.includes("missing")) {
        return {
          code: FieldCode.InvalidArgument,
          hint: "请求参数不符合阿里云接口要求，请检查附件字段和输入文件。",
          userVisibleAsText: true,
        };
      }
      return {
        code: FieldCode.Error,
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
        code: FieldCode.FeishuPaidBenefitsExhausted,
      };
    }

    const fileUrl = getAttachmentUrl(formItemParams.attachments);
    if (!fileUrl) {
      debugLog("config_error.missing_attachment_url");
      return {
        code: FieldCode.Success,
        data: "未获取到附件文件地址。请确认已绑定飞书附件字段，并且当前记录中已上传音频或视频文件。",
      };
    }

    try {
      debugLog("submit.request", {
        fileUrl,
        model: DEFAULT_MODEL,
      });

      const submitResponse = await fetchWithTimeout<DashScopeSubmitResponse>(
        SUBMIT_URL,
        {
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
        },
        AUTHORIZATION_ID,
      );

      const taskId = String(submitResponse.output?.task_id || "").trim();
      if (!taskId) {
        throw new Error(
          [submitResponse.code, submitResponse.message, "提交转写任务失败，未返回 task_id"].filter(Boolean).join(" | "),
        );
      }

      debugLog("submit.success", {
        taskId,
        taskStatus: submitResponse.output?.task_status,
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_POLL_MS) {
        await sleep(POLL_INTERVAL_MS);

        const taskResponse = await fetchWithTimeout<DashScopeTaskResponse>(
          `${TASK_URL_PREFIX}${encodeURIComponent(taskId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          },
          AUTHORIZATION_ID,
        );

        const taskStatus = String(taskResponse.output?.task_status || "").trim();
        debugLog("task.poll", {
          taskId,
          taskStatus,
        });

        if (taskStatus === "PENDING" || taskStatus === "RUNNING") {
          continue;
        }

        if (taskStatus !== "SUCCEEDED") {
          throw new Error(
            [taskResponse.code, taskResponse.message, `转写任务失败: ${taskStatus || "UNKNOWN"}`]
              .filter(Boolean)
              .join(" | "),
          );
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

        const transcriptPayload = await fetchWithTimeout<DashScopeTranscriptPayload>(transcriptionUrl, {
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
          code: FieldCode.Success,
          data: transcriptText,
        };
      }

      throw new Error("转写任务轮询超时，请稍后重试");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const descriptor = describeError(message);
      debugLog("error", { message, descriptor });

      if (descriptor.userVisibleAsText) {
        return {
          code: FieldCode.Success,
          data: descriptor.hint,
        };
      }

      return {
        code: descriptor.code,
      };
    }
  },
});

export default basekit;
