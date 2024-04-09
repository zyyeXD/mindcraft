import { readdirSync, readFileSync } from 'fs';
import { NPCData } from './data.js';
import { ItemGoal } from './item_goal.js';
import { BuildGoal } from './build_goal.js';
import { itemSatisfied, rotateXZ } from './utils.js';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';


export class NPCContoller {
    constructor(agent) {
        this.agent = agent;
        this.data = NPCData.fromObject(agent.prompter.prompts.npc);
        this.temp_goals = [];
        this.item_goal = new ItemGoal(agent, this.data);
        this.build_goal = new BuildGoal(agent);
        this.constructions = {};
    }

    getBuiltPositions() {
        let positions = [];
        for (let name in this.data.built) {
            let position = this.data.built[name].position;
            let offset = this.constructions[name].offset;
            let sizex = this.constructions[name].blocks[0][0].length;
            let sizez = this.constructions[name].blocks[0].length;
            let sizey = this.constructions[name].blocks.length;
            for (let y = offset; y < sizey+offset; y++) {
                for (let z = 0; z < sizez; z++) {
                    for (let x = 0; x < sizex; x++) {
                        positions.push({x: position.x + x, y: position.y + y, z: position.z + z});
                    }
                }
            }
        }
        return positions;
    }

    init() {
        if (this.data === null) return;

        for (let file of readdirSync('src/agent/npc/construction')) {
            if (file.endsWith('.json')) {
                try {
                    this.constructions[file.slice(0, -5)] = JSON.parse(readFileSync('src/agent/npc/construction/' + file, 'utf8'));
                } catch (e) {
                    console.log('Error reading construction file: ', file);
                }
            }
        }

        this.agent.bot.on('idle', async () => {
            // Wait a while for inputs before acting independently
            await new Promise((resolve) => setTimeout(resolve, 2000));
            if (!this.agent.isIdle()) return;

            // Persue goal
            if (!this.agent.coder.resume_func) {
                this.executeNext();
                this.agent.history.save();
            }
        });
    }

    async executeNext() {
        if (!this.agent.isIdle()) return;

        if (this.agent.bot.time.timeOfDay < 13000) {
            // Set daily goal
            if (this.data.curr_goal === null) {
                let next_goal = await this.agent.prompter.promptGoal(
                    this.agent.history.getHistory(),
                    this.data.prev_goal ? this.data.prev_goal.name : null,
                    this.data.prev_goal ? this.goalSatisfied(this.data.prev_goal.name, this.data.prev_goal.quantity): null,
                    this.data.prev_goal ? this.constructions[this.data.prev_goal.name] === undefined: null,
                    Object.keys(this.constructions)
                )
                if (next_goal !== null) {
                    try {
                        this.data.curr_goal = JSON.parse(next_goal);
                        console.log('Set goal to ', this.data.curr_goal);
                        this.agent.history.add('system', `Set goal to ${this.data.curr_goal.name} x${this.data.curr_goal.quantity}.`);
                    } catch (e) {
                        console.log(`Error setting goal ${next_goal}: `, e);
                    }
                }
            }

            // Exit any buildings
            let building = this.currentBuilding();
            if (building) {
                let door_pos = this.getBuildingDoor(building);
                if (door_pos) {
                    await this.agent.coder.execute(async () => {
                        await skills.useDoor(this.agent.bot, door_pos);
                    });
                }
            }

            // Work towards goals
            await this.executeGoal();

        } else {
            // Reset current goal
            this.data.prev_goal = this.data.curr_goal;
            this.data.curr_goal = null;

            // Return to home
            let building = this.currentBuilding();
            if (this.data.home !== null && (building === null || building != this.data.home)) {
                let door_pos = this.getBuildingDoor(this.data.home);
                await this.agent.coder.execute(async () => {
                    await skills.useDoor(this.agent.bot, door_pos);
                });
            }

            // Go to bed
            await this.agent.coder.execute(async () => {
                await skills.goToBed(this.agent.bot);
            });
        }
    }

    async executeGoal() {
        // If we need more blocks to complete a building, get those first
        let goals = this.temp_goals.concat(this.data.base_goals);
        if (this.data.curr_goal !== null) goals.push(this.data.curr_goal);
        this.temp_goals = [];

        for (let goal of goals) {

            // Obtain goal item or block
            if (this.constructions[goal.name] === undefined) {
                if (!itemSatisfied(this.agent.bot, goal.name, goal.quantity)) {
                    let res = await this.item_goal.executeNext(goal.name, goal.quantity);
                    if (res.message !== null && res.message !== '')
                        this.agent.history.add('system', res.message);
                    break;
                }
            }

            // Build construction goal
            else {
                let res = null;
                if (this.data.built.hasOwnProperty(goal.name)) {
                    res = await this.build_goal.executeNext(
                        this.constructions[goal.name],
                        this.data.built[goal.name].position,
                        this.data.built[goal.name].orientation
                    );
                } else {
                    res = await this.build_goal.executeNext(this.constructions[goal.name]);
                    this.data.built[goal.name] = {
                        name: goal.name,
                        position: res.position,
                        orientation: res.orientation,
                        finished: false
                    };
                }
                for (let block_name in res.missing) {
                    this.temp_goals.push({
                        name: block_name,
                        quantity: res.missing[block_name]
                    })
                }
                if (res.acted) {
                    if (Object.keys(res.missing).length === 0) {
                        if (this.constructions[goal.name].is_home)
                            this.data.home = goal.name;
                        this.data.built[goal.name].finished = true;
                        this.agent.history.add('system', `Finished building ${goal.name}.`);
                    } else {
                        this.agent.history.add('system', `Progressed towards building ${goal.name}.`);
                    }
                    break;
                }
            }
        }

        if (this.agent.isIdle())
            this.agent.bot.emit('idle');
    }

    goalSatisfied(goal_name, goal_quantity) {
        if (!goal_name) return false;
        if (this.constructions[goal_name] === undefined) {
            return itemSatisfied(this.agent.bot, goal_name, goal_quantity);
        } else {
            return this.data.built.hasOwnProperty(goal_name) && this.data.built[goal_name].finished;
        }
    }

    currentBuilding() {
        let bot_pos = this.agent.bot.entity.position;
        for (let name in this.data.built) {
            let pos = this.data.built[name].position;
            let offset = this.constructions[name].offset;
            let sizex = this.constructions[name].blocks[0][0].length;
            let sizez = this.constructions[name].blocks[0].length;
            let sizey = this.constructions[name].blocks.length;
            if (this.data.built[name].orientation % 2 === 1) [sizex, sizez] = [sizez, sizex];
            if (bot_pos.x >= pos.x && bot_pos.x < pos.x + sizex &&
                bot_pos.y >= pos.y + offset && bot_pos.y < pos.y + sizey + offset &&
                bot_pos.z >= pos.z && bot_pos.z < pos.z + sizez) {
                return name;
            }
        }
        return null;
    }

    getBuildingDoor(name) {
        if (name === null || this.data.built[name] === undefined) return null;
        let door_x = null;
        let door_z = null;
        let door_y = null;
        for (let y = 0; y < this.constructions[name].blocks.length; y++) {
            for (let z = 0; z < this.constructions[name].blocks[y].length; z++) {
                for (let x = 0; x < this.constructions[name].blocks[y][z].length; x++) {
                    if (this.constructions[name].blocks[y][z][x] !== null &&
                        this.constructions[name].blocks[y][z][x].includes('door')) {
                        door_x = x;
                        door_z = z;
                        door_y = y;
                        break;
                    }
                }
                if (door_x !== null) break;
            }
            if (door_x !== null) break;
        }
        if (door_x === null) return null;
        
        let sizex = this.constructions[name].blocks[0][0].length;
        let sizez = this.constructions[name].blocks[0].length;
        let orientation = this.data.built[name].orientation;
        [door_x, door_z] = rotateXZ(door_x, door_z, orientation, sizex, sizez);
        door_y += this.constructions[name].offset;

        return {
            x: this.data.built[name].position.x + door_x,
            y: this.data.built[name].position.y + door_y,
            z: this.data.built[name].position.z + door_z
        };
    }
}