export class NPCData {
    constructor() {
        this.base_goals = [];
        this.built = {};
        this.home = null;
        this.prev_goal = null;
        this.curr_goal = null;
    }

    toObject() {
        let obj = {};
        if (this.base_goals.length > 0)
            obj.base_goals = this.base_goals;
        if (Object.keys(this.built).length > 0)
            obj.built = this.built;
        if (this.home)
            obj.home = this.home;
        if (this.prev_goal)
            obj.prev_goal = this.prev_goal;
        if (this.curr_goal)
            obj.curr_goal = this.curr_goal;
        return obj;
    }

    static fromObject(obj) {
        if (!obj) return null;
        let npc = new NPCData();
        if (obj.base_goals) {
            npc.base_goals = [];
            for (let goal of obj.base_goals) {
                if (typeof goal === 'string')
                    npc.base_goals.push({name: goal, quantity: 1});
                else
                    npc.base_goals.push({name: goal.name, quantity: goal.quantity});
            }
        }
        if (obj.built)
            npc.built = obj.built;
        if (obj.home)
            npc.home = obj.home;
        if (obj.prev_goal)
            npc.prev_goal = obj.prev_goal;
        if (obj.curr_goal)
            npc.curr_goal = obj.curr_goal;
        return npc;
    }
}