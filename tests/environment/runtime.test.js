import { createLocalVue, mount } from '@vue/test-utils';
import Vuex from 'vuex';
import ExplicitSymbol from '@/components/ExplicitSymbol.vue';

// Verify that the test environment compiles real Vue SFCs and resolves aliases.
test('renders a Vue 2 component with its imported child', () => {
  const wrapper = mount(ExplicitSymbol, { propsData: { size: 20 } });
  try {
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.element.style.width).toBe('20px');
    expect(wrapper.find('use').attributes('href')).toBe('#icon-explicit');
  } finally {
    wrapper.destroy();
  }
});

test('connects Vuex actions, reactive rendering and browser storage', async () => {
  const localVue = createLocalVue();
  localVue.use(Vuex);
  const store = new Vuex.Store({
    state: { value: '' },
    mutations: {
      setValue(state, value) {
        state.value = value;
      },
    },
    actions: {
      restore({ commit }) {
        commit('setValue', localStorage.getItem('environment-test'));
      },
    },
  });
  const wrapper = mount(
    {
      render(h) {
        return h('span', this.$store.state.value);
      },
    },
    { localVue, store }
  );
  try {
    localStorage.setItem('environment-test', 'ready');
    await store.dispatch('restore');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toBe('ready');
  } finally {
    wrapper.destroy();
    localStorage.removeItem('environment-test');
  }
});
