import { testField, createFieldContext } from "@lark-opdev/block-basekit-server-api";

async function run() {
    const context = await createFieldContext({
        baseSignature: "",
        baseID: "",
        tableID: "",
        packID: "extract-text-local-test",
        tenantKey: "",
        baseOwnerID: "",
        isNeedPayPack: false,
        hasQuota: true,
    });
    testField({
        attachments: [
            {
                name: "douyin-video.mp4",
                size: 0,
                type: "video/mp4",
                tmp_url: "https://v11-weba.douyinvod.com/ed067261e2072fcf03cd37268c4eea0c/69f04e8d/video/tos/cn/tos-cn-ve-15/3bec66b372f14a9184ab5ace4ed461d2/?a=6383&br=225&bt=225&btag=c0000e00028000&cd=0%7C0%7C0%7C3&ch=26&cquery=100B_100H_100K_100o_100w&cr=3&cs=0&cv=1&dr=0&ds=3&dy_q=1777345480&feature_id=37f92ebd2877ae8e7eba995d406c5150&ft=AJkeU_TLRR0sT1C4-Dv2Nc.xBiGNbLmsKR-U_4RjJmVJNv7TGW&is_ssr=1&l=20260428110439AB7100CA8EEA3BBF3571&lr=all&mime_type=video_mp4&qs=1&rc=N2Y3Zzg4OWc3NjhkZzY2aEBpajQ1cWw5cms2OjMzNGkzM0AvNC4tNmAwNWAxYzMvMDJeYSNlZ3BvMmQ0bmdhLS1kLTBzcw%3D%3D&__vid=7630855426069892390",
            },
        ],
    }, context as any);
}

run();
