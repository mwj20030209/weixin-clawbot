<script setup lang="ts">
defineProps<{ open: boolean; width?: string }>()
defineEmits<{ (e: 'update:open', v: boolean): void }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4"
        style="background: rgba(29,33,41,.45); backdrop-filter: blur(4px);"
        @click.self="$emit('update:open', false)"
      >
        <div
          class="modal-panel bg-white w-full overflow-hidden
                 rounded-t-[16px] sm:rounded-[12px]
                 max-h-[92dvh] sm:max-h-[88vh]
                 flex flex-col"
          :style="{ maxWidth: `min(100%, ${width || '480px'})`, boxShadow: '0 20px 48px rgba(20,30,55,0.18)' }"
          @click.stop
        >
          <!-- 手机端拖动指示条 -->
          <div class="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
            <div class="w-10 h-1 rounded-full bg-[#E5E6EB]" />
          </div>
          <!-- 内容区（可滚动） -->
          <div class="overflow-y-auto overscroll-contain flex-1 min-h-0">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 桌面端：淡入+上移 */
.modal-enter-active, .modal-leave-active { transition: opacity .2s ease; }
.modal-enter-active .modal-panel, .modal-leave-active .modal-panel {
  transition: transform .25s cubic-bezier(.16,1,.3,1), opacity .2s;
}
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (min-width: 640px) {
  .modal-enter-from .modal-panel, .modal-leave-to .modal-panel {
    transform: translateY(8px) scale(.98); opacity: 0;
  }
}

/* 手机端：从底部滑入 */
@media (max-width: 639px) {
  .modal-enter-from .modal-panel, .modal-leave-to .modal-panel {
    transform: translateY(100%); opacity: 0;
  }
}
</style>
