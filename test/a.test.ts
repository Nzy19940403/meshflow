import { it, expect, vi, describe } from 'vitest';
import { useEngineManager, useEngine } from "@/utils/hooks/useEngineManager";
import { Schema } from "@/devSchemaConfig/dev.form.Schema";
import { ref } from 'vue';

describe('云厂商竞态联动测试',()=>{
    it('应当丢弃过期的异步请求，确保最终一致性',async ()=>{
        vi.useFakeTimers();

        const engine = useEngineManager('engine',Schema, {
            signalCreateor: () => 0,
            signalTrigger(signal) {
              signal++;
            },
        });
        engine.config.SetRule(
            'cloudConsole.environment.region',
            'cloudConsole.specs.instanceFamily',
            'defaultValue',
            {
                logic:async ({slot})=>{
                    const [val] = slot.triggerTargets;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        )
        
    })
})